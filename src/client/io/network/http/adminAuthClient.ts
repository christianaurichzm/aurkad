import { httpClient } from './httpClient';

export interface AdminSession {
  username: string;
  access: number;
}

export async function adminLogin(
  username: string,
  password: string,
): Promise<AdminSession> {
  const res = await httpClient<AdminSession>('/admin/login', {
    method: 'POST',
    body: { username, password },
  });
  if (!res) throw { message: 'Login failed' };
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
