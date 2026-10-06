export type ServerMode = 'normal' | 'maintenance' | 'gm_only';

export const serverState = {
  mode: 'normal' as ServerMode,
  motd: '',
  mutes: new Map<string, number>(), // username → expiry ms, 0 = permanent
  // listener → the senders they will not hear. The mirror of `mutes`: that
  // is the operator deciding who may speak, this is a player deciding who
  // they listen to. Runtime only: whoever owns the policy states it again on
  // join and drops it on leave, as the core has no opinion on the list.
  ignores: new Map<string, Set<string>>(),
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

/**
 * Whether one player's chat reaches another. Consulted per recipient in the
 * fan-out, which is the one place every scope of chat crosses.
 */
export function hearsFrom(listener: string, sender?: string): boolean {
  if (!sender || sender === listener) return true;
  return !serverState.ignores.get(listener)?.has(sender);
}

/** Replaces the whole list; an empty one drops the entry. */
export function setIgnored(listener: string, senders: string[]): void {
  if (senders.length === 0) serverState.ignores.delete(listener);
  else serverState.ignores.set(listener, new Set(senders));
}
