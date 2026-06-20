import { config } from '../config.js';
import { getPlayerById } from '../sim/world.js';
import { persistPlayerSessionState } from '../services/playerService.js';
import { drainDirtyPlayerIds } from './dirtyPlayers.js';

type IntervalHandle = ReturnType<typeof setInterval>;

async function persistDirtyPlayers(): Promise<void> {
  for (const id of drainDirtyPlayerIds()) {
    const player = getPlayerById(id);
    if (player) await persistPlayerSessionState(player);
  }
}

export function startPlayerSnapshotLoop(): () => void {
  const intervalMs = config.persistence.playerSnapshotIntervalMs;
  if (intervalMs <= 0) {
    return () => {};
  }

  let running = false;

  const handle: IntervalHandle = setInterval(() => {
    if (running) return;

    running = true;
    persistDirtyPlayers()
      .catch((e) => {
        console.error('[snapshot] persistDirtyPlayers failed:', e);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  handle.unref?.();

  return () => clearInterval(handle);
}
