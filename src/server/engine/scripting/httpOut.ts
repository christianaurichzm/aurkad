// Outbound HTTP for scripts and modules: the one way sandboxed code reaches
// a service outside (a Discord webhook, an alert, a community site).
//
// It never rejects. `safeOn` wraps only the synchronous call, so a webhook
// fired without awaiting is a floating promise, and an unhandled rejection
// ends the process; failures come back as `{ ok: false, error }`.
//
// It refuses this machine and its network, and connects to the address it
// checked. Scripts are the owner's code, so this guards against a URL from
// a less trusted place, like a webhook typed into a content field and
// pointed at the metadata service or Mongo. node:http rather than fetch,
// which resolves the name again: the socket is handed the approved address.

import { lookup } from 'node:dns/promises';
import { request as httpTransport } from 'node:http';
import { request as httpsTransport } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
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

/** Where the request may go: one approved address, or the reason it may not. */
type Destination = { address: string } | { refusal: string };

async function approve(target: URL): Promise<Destination> {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { refusal: `unsupported protocol ${target.protocol}` };
  }

  // Bracketed IPv6 hosts arrive as [::1].
  const host = target.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    return isPrivateAddress(host)
      ? { refusal: `blocked address ${host}` }
      : { address: host };
  }

  let resolved: string;
  try {
    resolved = (await lookup(host)).address;
  } catch {
    return { refusal: `cannot resolve ${host}` };
  }

  return isPrivateAddress(resolved)
    ? { refusal: `blocked address ${resolved} for ${host}` }
    : { address: resolved };
}

/**
 * The lookup the socket gets: the address `approve` cleared, whatever DNS
 * says now, so a resolver that answers 93.x on the check and 127.0.0.1 on
 * the connection is never asked twice. Both call shapes are answered: Node
 * asks for every address when racing families (the default since 20), and
 * for one otherwise.
 */
function pinTo(address: string): LookupFunction {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/**
 * One request, to an address already approved. Rejects on a transport
 * failure, which `httpRequest` turns into a result. Reads at most
 * MAX_BODY_BYTES, counted on the wire, so the request asks for no
 * compression: 256KB of gzip is not 256KB of memory. Exported for the tests,
 * the only way to reach a real socket on this machine.
 */
export function send(
  target: URL,
  address: string,
  options: HttpRequestOptions & { body?: string },
): Promise<HttpResponse> {
  const transport =
    target.protocol === 'https:' ? httpsTransport : httpTransport;

  const headers: Record<string, string> = { ...options.headers };
  const body = options.body;
  if (body !== undefined) {
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  // The result is a string, so a compressed body would be unreadable, and
  // the byte cap can only measure an uncompressed one.
  headers['accept-encoding'] = 'identity';

  const timeoutMs = Math.min(
    Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 1),
    MAX_TIMEOUT_MS,
  );

  return new Promise<HttpResponse>((resolve, reject) => {
    // Redirects are not followed (node:http does not on its own): one to
    // 127.0.0.1 would walk past the check, and webhooks do not redirect, so
    // the 3xx comes back as a result.
    const req = transport(
      target,
      {
        method: options.method ?? (body === undefined ? 'GET' : 'POST'),
        headers,
        lookup: pinTo(address),
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        // Uint8Array rather than Buffer: that is what Buffer.concat takes, and
        // @types/node does not treat the two as interchangeable.
        const chunks: Uint8Array[] = [];
        let total = 0;
        const status = res.statusCode ?? 0;
        const finish = () =>
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(chunks)
              .subarray(0, MAX_BODY_BYTES)
              .toString('utf8'),
          });

        res.on('data', (chunk: Uint8Array) => {
          chunks.push(chunk);
          total += chunk.byteLength;
          if (total >= MAX_BODY_BYTES) {
            // Resolves with what arrived; the destroy below makes the stream
            // emit after the promise has settled, where it is ignored.
            res.destroy();
            finish();
          }
        });
        res.on('end', finish);
        res.on('error', reject);
      },
    );

    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
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

  const destination = await approve(target);
  if ('refusal' in destination) return failed(destination.refusal);

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

  try {
    return await send(target, destination.address, {
      ...options,
      headers,
      body,
    });
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}
