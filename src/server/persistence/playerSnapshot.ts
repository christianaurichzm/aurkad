import { config } from '../config.js';
import { getPlayerById } from '../sim/world.js';
import { persistPlayerSessionState } from '../services/playerService.js';
import { drainDirtyPlayerIds, markPlayerDirty } from './dirtyPlayers.js';
import { logger } from '../logger.js';

type IntervalHandle = ReturnType<typeof setInterval>;

async function persistDirtyPlayers(): Promise<void> {
  const failed: string[] = [];
  for (const id of drainDirtyPlayerIds()) {
    const player = getPlayerById(id);
    if (!player) continue;
    try {
      await persistPlayerSessionState(player);
    } catch {
      failed.push(id);
    }
  }
  for (const id of failed) markPlayerDirty(id);
  if (failed.length > 0)
    throw new Error(`Failed to persist ${failed.length} player(s)`);
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
        logger.error('[snapshot] persistDirtyPlayers failed', { err: e });
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  handle.unref?.();

  return () => clearInterval(handle);
}
