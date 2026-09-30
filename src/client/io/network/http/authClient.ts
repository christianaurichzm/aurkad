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

/** What the game is called and the picture it goes by (game.json `brand`). */
export interface GameBrand {
  name: string;
  logo: string;
  /** Whether the game has levels and experience at all (`leveling.enabled`). */
  levels: boolean;
  /** Whether levels hand out attribute points (`leveling.pointsPerLevel`). */
  attributes: boolean;
}

let gameBrand: Promise<GameBrand | null> | undefined;
let gameBrandNow: GameBrand | null = null;

/**
 * Asked once per page: the tab, favicon and auth screens all want it, and it
 * changes only when the server restarts on another game.json.
 */
export const fetchGameBrand = () =>
  (gameBrand ??= httpClient<GameBrand>('/game', { method: 'GET' })
    .then((brand) => (gameBrandNow = brand))
    .catch(() => null));

/**
 * The answer once it arrived, for the canvas, which draws every frame and
 * cannot await. main.tsx asks at boot, long before a world is drawn.
 */
export const getGameBrand = () => gameBrandNow;

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
