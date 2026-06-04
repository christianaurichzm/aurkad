import { config } from '../config.js';
import {
  processMovementIntent,
  processMovementCompletion,
} from '../services/gameService.js';
import { rebuildQuadtree } from '../spatial/SpatialManager.js';
import { getGameState } from '../services/gameService.js';
import { ServerActionType } from '../engine/actions.js';
import { processActions, enqueueServerAction } from '../net/transport.js';
import { broadcastGameState, flushGameEvents } from '../net/snapshot.js';
import { advanceTick } from './clock.js';

type TimeoutHandle = ReturnType<typeof setTimeout>;

function rebuildSpatialIndexes() {
  try {
    const state = getGameState();
    if (!state?.maps) return;

    for (const [mapId, map] of Object.entries(state.maps)) {
      if (map?.players && map.npcs) {
        rebuildQuadtree(mapId, map);
      }
    }
  } catch (err) {
    console.error('[spatial] Failed to rebuild quadtree:', err);
  }
}

const tickSystems: Array<{ name: string; run: () => unknown }> = [
  { name: 'advanceTick', run: advanceTick },
  { name: 'rebuildSpatialIndexes', run: rebuildSpatialIndexes },
  { name: 'processActions', run: processActions },
  { name: 'processMovementIntent', run: processMovementIntent },
  { name: 'processMovementCompletion', run: processMovementCompletion },
  { name: 'flushGameEvents', run: flushGameEvents },
  { name: 'broadcastGameState', run: broadcastGameState },
];

function runTickSystems() {
  for (const system of tickSystems) {
    try {
      const result = system.run();
      if (result instanceof Promise) {
        result.catch((e) => {
          console.error(`[tick] system failed: ${system.name}`, e);
        });
      }
    } catch (e) {
      console.error(`[tick] system failed: ${system.name}`, e);
    }
  }
}

export function startGameLoops(): () => void {
  const TICK_RATE = config.gameLoop.tickRate;
  const MAX_UPDATES_PER_TICK = config.gameLoop.maxUpdatesPerTick;

  const tickInterval = 1000 / TICK_RATE;
  let lastUpdateTime = Date.now();
  let running = true;
  let tickTimeout: TimeoutHandle | undefined;

  const tick = () => {
    if (!running) return;
    const now = Date.now();
    let updates = 0;

    while (
      now - lastUpdateTime >= tickInterval &&
      updates < MAX_UPDATES_PER_TICK
    ) {
      runTickSystems();
      lastUpdateTime += tickInterval;
      updates++;
    }

    const delay = Math.max(0, tickInterval - (Date.now() - lastUpdateTime));
    tickTimeout = setTimeout(tick, delay);
  };

  tick();

  const npcInterval = setInterval(() => {
    enqueueServerAction(ServerActionType.UpdateNpcPositions);
  }, 1250);

  const regenInterval = setInterval(() => {
    enqueueServerAction(ServerActionType.RegeneratePlayersHP);
  }, 5000);

  return () => {
    running = false;
    if (tickTimeout) clearTimeout(tickTimeout);
    clearInterval(npcInterval);
    clearInterval(regenInterval);
  };
}
