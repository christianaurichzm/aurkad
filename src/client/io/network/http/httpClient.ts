import type { HttpRequestOptions } from '../../../../shared/types';

const API_URL = import.meta.env.VITE_APP_API_URL;
const REST_PROTO = import.meta.env.VITE_REST_PROTOCOL;

export { API_URL, REST_PROTO };

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
  let data: any;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const message =
      (typeof data === 'object' && (data?.message || data?.error)) ||
      (typeof data === 'string' && data) ||
      `Request failed (${response.status})`;
    throw { status: response.status, message };
  }

  return data as T;
};
