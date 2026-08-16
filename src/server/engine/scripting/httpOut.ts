// Outbound HTTP for scripts and modules: the one way sandboxed code reaches
// a service outside (a Discord webhook, an alert, a community site).
//
// It never rejects. `safeOn` wraps only the synchronous call, so a webhook
// fired without awaiting is a floating promise, and an unhandled rejection
// ends the process; failures come back as `{ ok: false, error }`.
//
// It refuses this machine and its network. Scripts are the owner's code, so
// this guards against a URL from a less trusted place, like a webhook typed
// into a content field and pointed at the metadata service or Mongo.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { logger } from '../../logger.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 256 * 1024;

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Raw body. Ignored when `json` is given. */
  body?: string;
  /** Serialized as the body, with the content type set. The common case. */
  json?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  body: string;
  /** Set only when the request never produced a response. */
  error?: string;
}

/**
 * Addresses that mean "this machine or this network", written out rather
 * than taken from a library: the list is short, and a parser disagreeing
 * with a resolver about an address is the very bug class at stake.
 */
function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (parts.length !== 4 || a === undefined || b === undefined) return true;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link local, and the cloud metadata service
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // carrier grade nat
  );
}

/**
 * The eight 16-bit groups of an IPv6 address, or null when it will not
 * parse. Expanded rather than pattern-matched, since one address has many
 * spellings and `new URL` picks its own: it turns `[::ffff:127.0.0.1]` into
 * the `::ffff:7f00:1` form.
 */
function v6Groups(address: string): number[] | null {
  // A dotted tail is the same address written differently: fold it into two
  // groups first so there is one code path below.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  let text = address;
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n === undefined || n > 255)) return null;
    text =
      address.slice(0, dotted.index) +
      (((a! << 8) | b!) >>> 0).toString(16) +
      ':' +
      (((c! << 8) | d!) >>> 0).toString(16);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string | undefined): number[] =>
    part ? part.split(':').map((g) => parseInt(g, 16)) : [];

  const left = parse(halves[0]);
  if (halves.length === 1) return left.length === 8 ? left : null;

  const right = parse(halves[1]);
  const zeros = 8 - left.length - right.length;
  if (zeros < 0) return null;

  const groups = [...left, ...Array<number>(zeros).fill(0), ...right];
  return groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)
    ? null
    : groups;
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) !== 6) return isPrivateV4(ip);

  const g = v6Groups(ip.toLowerCase());
  if (!g) return true; // unreadable address: refuse rather than guess

  if (g.every((group) => group === 0)) return true; // ::
  if (g.slice(0, 7).every((group) => group === 0) && g[7] === 1) return true;
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link local

  // ::ffff:0:0/96, an IPv4 address wearing a hat.
  if (g.slice(0, 5).every((group) => group === 0) && g[5] === 0xffff) {
    const hi = g[6]!;
    const lo = g[7]!;
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  return false;
}

/** Rejected destinations, or null when the URL is allowed. */
async function refuse(target: URL): Promise<string | null> {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return `unsupported protocol ${target.protocol}`;
  }

  // Bracketed IPv6 hosts arrive as [::1].
  const host = target.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    return isPrivateAddress(host) ? `blocked address ${host}` : null;
  }

  let resolved: string;
  try {
    resolved = (await lookup(host)).address;
  } catch {
    return `cannot resolve ${host}`;
  }

  // Resolve-then-fetch leaves a TOCTOU window: fetch resolves again, and a
  // hostile DNS server can answer differently the second time. Closing it
  // takes an undici dispatcher with this lookup pinned, worth writing once
  // these URLs stop being the operator's own.
  return isPrivateAddress(resolved)
    ? `blocked address ${resolved} for ${host}`
    : null;
}

/** Reads at most MAX_BODY_BYTES: an endless response cannot fill the heap. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total >= MAX_BODY_BYTES) {
      await reader.cancel();
      break;
    }
  }

  return Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8');
}

export async function httpRequest(
  scriptName: string,
  rawUrl: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const failed = (error: string): HttpResponse => {
    logger.warn(`[script:${scriptName}] http request failed`, {
      url: rawUrl,
      error,
    });
    return { ok: false, status: 0, body: '', error };
  };

  let target: URL;
  try {
    target = new URL(String(rawUrl));
  } catch {
    return failed('invalid url');
  }

  const refusal = await refuse(target);
  if (refusal) return failed(refusal);

  const headers: Record<string, string> = { ...options.headers };
  let body = options.body;
  if (options.json !== undefined) {
    try {
      body = JSON.stringify(options.json);
    } catch {
      return failed('json body is not serializable');
    }
    headers['content-type'] = 'application/json';
  }

  const timeoutMs = Math.min(
    Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 1),
    MAX_TIMEOUT_MS,
  );

  try {
    const response = await fetch(target, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      // Not followed: a redirect to 127.0.0.1 walks straight past the check
      // above, and following one safely means re-checking every hop. Webhooks
      // do not redirect, so the 3xx comes back as a result and the caller
      // fixes the URL.
      redirect: 'manual',
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await readCapped(response),
    };
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}
