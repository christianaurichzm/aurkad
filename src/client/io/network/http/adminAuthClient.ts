import { httpClient, type HttpError } from './httpClient';
import { Access } from '../../../../shared/types';

export interface AdminSession {
  username: string;
  access: Access;
  scriptEditorEnabled: boolean;
}

export async function adminLogin(
  username: string,
  password: string,
): Promise<AdminSession> {
  const res = await httpClient<AdminSession>('/admin/login', {
    method: 'POST',
    body: { username, password },
  });
  // Status 0: the request succeeded, so there is no HTTP status to report;
  // the server answered without a session.
  if (!res) {
    const failure: HttpError = { status: 0, message: 'Login failed' };
    throw failure;
  }
  return res;
}

export async function adminSession(): Promise<AdminSession | null> {
  try {
    return await httpClient<AdminSession>('/admin/session', { method: 'GET' });
  } catch {
    return null;
  }
}

export async function adminLogout(): Promise<void> {
  await httpClient('/admin/logout', { method: 'POST' }).catch(() => undefined);
}
