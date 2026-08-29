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
  totpToken?: string,
): Promise<AdminSession> {
  const res = await httpClient<AdminSession>('/admin/login', {
    method: 'POST',
    body: { username, password, ...(totpToken ? { totpToken } : {}) },
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

/** How the panel's own account is protected, from the session holding it. */
export interface TwoFactorStatus {
  enabled: boolean;
  recoveryLeft: number;
}

export async function fetchTwoFactor(): Promise<TwoFactorStatus | null> {
  return httpClient<TwoFactorStatus>('/admin/2fa', { method: 'GET' });
}

/**
 * Starts an enrollment; the secret comes back once, for the app to read.
 * Nothing is stored until `confirmTwoFactor` accepts a code, so closing the
 * screen here changes nothing.
 */
export async function beginTwoFactor(currentPassword: string) {
  return httpClient<{ secret: string; otpauthUrl: string }>(
    '/admin/2fa/setup',
    { method: 'POST', body: { currentPassword } },
  );
}

export async function confirmTwoFactor(totpToken: string) {
  return httpClient<{ recoveryCodes: string[] }>('/admin/2fa/enable', {
    method: 'POST',
    body: { totpToken },
  });
}

export async function removeTwoFactor(
  currentPassword: string,
  totpToken: string,
) {
  return httpClient<{ success: boolean }>('/admin/2fa/disable', {
    method: 'POST',
    body: { currentPassword, totpToken },
  });
}
