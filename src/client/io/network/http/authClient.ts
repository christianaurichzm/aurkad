import type { Player, MapStateClient } from '../../../../shared/types';
import { httpClient } from './httpClient';

export const login = async (username: string, password: string) => {
  return await httpClient<{
    player: Player;
    map: MapStateClient;
    assetKey: string;
    motd?: string;
  }>('/login', {
    method: 'POST',
    body: { username, password },
  });
};

export const register = async (username: string, password: string) => {
  return await httpClient<{ success: boolean }>('/register', {
    method: 'POST',
    body: { username, password },
  });
};

export async function silentAction<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return null;
    }
    throw error;
  }
}
