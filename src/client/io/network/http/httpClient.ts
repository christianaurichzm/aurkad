import type { HttpRequestOptions } from '../../../../shared/types';
import { t } from '../../../i18n';

const API_URL = import.meta.env.VITE_APP_API_URL as string | undefined;
const REST_PROTO = import.meta.env.VITE_REST_PROTOCOL as string | undefined;

export { API_URL, REST_PROTO };

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

const buildUrl = (endpoint: string): string =>
  API_URL && REST_PROTO ? `${REST_PROTO}://${API_URL}${endpoint}` : endpoint;

export const httpClient = async <T>(
  endpoint: string,
  { method, headers, body }: HttpRequestOptions,
): Promise<T | null> => {
  const response = await fetch(buildUrl(endpoint), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
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
        ? (data as { message?: string; error?: string })
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
    };
    throw failure;
  }

  return data as T;
};
