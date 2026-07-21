import { config } from '../config.js';
import { getPlayerById } from '../sim/world.js';
import { persistPlayerSessionState } from '../services/player/playerService.js';
import { drainDirtyPlayerIds, markPlayerDirty } from './dirtyPlayers.js';
import { logger } from '../logger.js';

type IntervalHandle = ReturnType<typeof setInterval>;

async function persistDirtyPlayers(): Promise<void> {
  const ids = drainDirtyPlayerIds().filter((id) => getPlayerById(id));
  const results = await Promise.allSettled(
    ids.map((id) => persistPlayerSessionState(getPlayerById(id)!)),
  );

  const failed = ids.filter((_, i) => results[i]!.status === 'rejected');
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
