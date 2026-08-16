import type { HttpRequestOptions } from '../../../../shared/types';

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
}

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
    const failure: HttpError = { status: response.status, message };
    throw failure;
  }

  return data as T;
};
