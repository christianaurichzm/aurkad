import { config } from '../config.js';
import { players } from '../gameData.js';
import { persistPlayerSessionState } from '../services/playerService.js';

type IntervalHandle = ReturnType<typeof setInterval>;

async function persistAllPlayers(): Promise<void> {
  for (const player of Object.values(players)) {
    await persistPlayerSessionState(player);
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
    persistAllPlayers()
      .catch((e) => {
        console.error('[snapshot] persistAllPlayers failed:', e);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  handle.unref?.();

  return () => clearInterval(handle);
}
