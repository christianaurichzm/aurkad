import type { Player, MapMetaClient } from '../../../../shared/types';
import { httpClient, httpError } from './httpClient';

export const login = async (
  username: string,
  password: string,
  remember = false,
  totpToken?: string,
) => {
  return await httpClient<{
    player: Player;
    map: MapMetaClient;
    assetKey: string;
    motd?: string;
  }>('/login', {
    method: 'POST',
    body: { username, password, remember, ...(totpToken ? { totpToken } : {}) },
  });
};

export const register = async (username: string, password: string) => {
  return await httpClient<{ success: boolean }>('/register', {
    method: 'POST',
    body: { username, password },
  });
};

export const changePassword = async (
  currentPassword: string,
  newPassword: string,
) => {
  return await httpClient<{ success: boolean }>('/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
};

export const requestPasswordReset = async (username: string) => {
  return await httpClient<{ success: boolean }>('/password/reset', {
    method: 'POST',
    body: { username },
  });
};

export const confirmPasswordReset = async (
  token: string,
  newPassword: string,
) => {
  return await httpClient<{ success: boolean }>('/password/reset/confirm', {
    method: 'POST',
    body: { token, newPassword },
  });
};

/** The address a reset link would go to, or null while there is none. */
export const fetchEmail = async () => {
  return await httpClient<{ email: string | null }>('/email', {
    method: 'GET',
  });
};

/**
 * Points the account at an address, stored only once the emailed link comes
 * back, so `sent` is all the screen can report.
 */
export const setEmail = async (currentPassword: string, email: string) => {
  return await httpClient<{ success: boolean; sent: boolean }>('/email', {
    method: 'POST',
    body: { currentPassword, email },
  });
};

/**
 * What this deployment offers before anyone logs in. No `mail` transport
 * means no reset link on the login screen and no address field in settings.
 */
export const fetchAuthCapabilities = async () => {
  return await httpClient<{ mail: boolean }>('/auth/capabilities', {
    method: 'GET',
  });
};

export async function silentAction<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    const { status } = httpError(error);
    if (status === 401 || status === 403) {
      return null;
    }
    throw error;
  }
}
