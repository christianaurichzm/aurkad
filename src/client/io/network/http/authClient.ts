import type { Player, MapMetaClient } from '../../../../shared/types';
import { httpClient, httpError } from './httpClient';

export const login = async (
  username: string,
  password: string,
  remember = false,
) => {
  return await httpClient<{
    player: Player;
    map: MapMetaClient;
    assetKey: string;
    motd?: string;
  }>('/login', {
    method: 'POST',
    body: { username, password, remember },
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

/** What this deployment can offer before anyone has logged in. */
export const fetchAuthCapabilities = async () => {
  return await httpClient<{ passwordReset: boolean }>('/auth/capabilities', {
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
