import type { HttpRequestOptions } from '../../../../shared/types';
import { getLanguage, t } from '../../../i18n';

const API_URL = import.meta.env.VITE_APP_API_URL as string | undefined;
const REST_PROTO = import.meta.env.VITE_REST_PROTOCOL as string | undefined;

/**
 * What every rejected httpClient call throws. Not an Error: callers branch
 * on `status` (silentAction swallows 401/403) and show `message` as is. Read
 * it through `httpError`, since a fetch can also reject with a TypeError.
 */
export interface HttpError {
  status: number;
  message: string;
  /**
   * The id the server stamped on this request, when it failed. Responses and
   * server log lines carry the same `X-Request-Id`, so a player's report can
   * lead straight to the stack.
   */
  requestId?: string;
  /**
   * Set when the password was right and the server wants the second factor.
   * The screen shows the code field on this, as nothing before the attempt
   * says the account is enrolled.
   */
  twoFactorRequired?: boolean;
}

/**
 * The same failure, worded for a player. A 4xx explains what the caller did
 * (wrong password, name taken) and is shown as is. A 5xx like "Internal
 * server error" tells a player nothing, so it is replaced. Operator screens
 * show the raw text.
 */
export const friendlyHttpError = (e: unknown): string => {
  const { status, message, requestId } = httpError(e);
  if (status !== undefined && status < 500 && message) return message;
  const failed = t('common.serverError');
  return requestId
    ? `${failed} (${t('common.errorRef', { id: requestId })})`
    : failed;
};

export const httpError = (e: unknown): Partial<HttpError> =>
  typeof e === 'object' && e !== null ? e : {};

// Where a warp sent the socket. The character lives on that instance
// alone, so a purchase or point spent asked of another finds no one.
let instanceOrigin: string | undefined;

export function followInstance(wsUrl: string): void {
  instanceOrigin = new URL(wsUrl.replace(/^ws/, 'http')).origin;
}

const buildUrl = (endpoint: string): string =>
  instanceOrigin
    ? `${instanceOrigin}${endpoint}`
    : API_URL && REST_PROTO
      ? `${REST_PROTO}://${API_URL}${endpoint}`
      : endpoint;

const hex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/**
 * A W3C `traceparent` for one request. The trace starts in the browser, or
 * the server could never tell a slow network from a slow handler. `01` is
 * the sampled flag; the server's sampler makes the call.
 */
const traceparent = (): string => `00-${hex(16)}-${hex(8)}-01`;

export const httpClient = async <T>(
  endpoint: string,
  { method, headers, body }: HttpRequestOptions,
): Promise<T | null> => {
  // A file goes as its own bytes under its own type; everything else is JSON.
  const file = body instanceof Blob ? body : null;
  const response = await fetch(buildUrl(endpoint), {
    method,
    headers: {
      'Content-Type': file ? file.type : 'application/json',
      // The language the player chose, which the server answers a refusal in;
      // the browser's own Accept-Language is the system's, not the game's.
      'Accept-Language': getLanguage(),
      traceparent: traceparent(),
      ...headers,
    },
    body: file ?? (body ? JSON.stringify(body) : undefined),
    credentials: 'include',
  });

  const contentType = response.headers.get('Content-Type');
  const data: unknown =
    contentType && contentType.includes('application/json')
      ? await (response.json() as Promise<unknown>)
      : await response.text();

  if (!response.ok) {
    const body =
      typeof data === 'object' && data !== null
        ? (data as {
            message?: string;
            error?: string;
            twoFactorRequired?: boolean;
          })
        : null;
    const message =
      body?.message ||
      body?.error ||
      (typeof data === 'string' && data) ||
      `Request failed (${response.status})`;
    const failure: HttpError = {
      status: response.status,
      message,
      requestId: response.headers.get('X-Request-Id') ?? undefined,
      ...(body?.twoFactorRequired ? { twoFactorRequired: true } : {}),
    };
    throw failure;
  }

  return data as T;
};
