import type { HttpRequestOptions } from '../../../../shared/types';

const API_URL = import.meta.env.VITE_APP_API_URL;
const REST_PROTO = import.meta.env.VITE_REST_PROTOCOL;

export { API_URL, REST_PROTO };

export const httpClient = async <T>(
  endpoint: string,
  { method, headers, body }: HttpRequestOptions,
): Promise<T | null> => {
  const response = await fetch(`${REST_PROTO}://${API_URL}${endpoint}`, {
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
    throw {
      status: response.status,
      message:
        data?.message ||
        data?.error ||
        `Error: ${response.status} - ${response.statusText} - ${data}`,
    };
  }

  return data as T;
};
