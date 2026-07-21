export type ServerMode = 'normal' | 'maintenance' | 'gm_only';

export const serverState = {
  mode: 'normal' as ServerMode,
  motd: '',
  mutes: new Map<string, number>(), // username → expiry ms, 0 = permanent
};

export function isMuted(username: string): boolean {
  const expiry = serverState.mutes.get(username);
  if (expiry === undefined) return false;
  if (expiry === 0) return true;
  if (Date.now() > expiry) {
    serverState.mutes.delete(username);
    return false;
  }
  return true;
}
