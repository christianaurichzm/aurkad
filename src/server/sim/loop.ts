import { config } from '../config.js';
import { logger } from '../logger.js';
import { recordTick } from '../metrics.js';
import {
  processMovementIntent,
  processMovementCompletion,
} from '../services/gameService.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';
import { getGameState } from '../services/gameService.js';
import { ServerActionType } from '../engine/actions.js';
import {
  processActions,
  enqueueServerAction,
  getActionQueueSize,
} from '../net/transport.js';
import { broadcastGameState, flushGameEvents } from '../net/snapshot.js';
import { advanceTick, getTick, msToTicks } from './clock.js';

type TimeoutHandle = ReturnType<typeof setTimeout>;

const NPC_UPDATE_TICKS = msToTicks(1250);
const REGEN_TICKS = msToTicks(5000);

function scheduledServerActions() {
  const tick = getTick();
  if (tick % NPC_UPDATE_TICKS === 0) {
    enqueueServerAction(ServerActionType.UpdateNpcPositions);
  }
  if (tick % REGEN_TICKS === 0) {
    enqueueServerAction(ServerActionType.RegeneratePlayersHP);
  }
}

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
    logger.error('[spatial] Failed to rebuild quadtree', { tick: getTick(), err });
  }
}

const tickSystems: Array<{ name: string; run: () => unknown }> = [
  { name: 'advanceTick', run: advanceTick },
  { name: 'scheduledServerActions', run: scheduledServerActions },
  { name: 'rebuildSpatialIndexes', run: rebuildSpatialIndexes },
  { name: 'processActions', run: processActions },
  { name: 'processMovementCompletion', run: processMovementCompletion },
  { name: 'processMovementIntent', run: processMovementIntent },
  { name: 'flushGameEvents', run: flushGameEvents },
  { name: 'broadcastGameState', run: broadcastGameState },
];

function runTickSystems() {
  for (const system of tickSystems) {
    try {
      const result = system.run();
      if (result instanceof Promise) {
        result.catch((e) => {
          logger.error(`[tick] system failed: ${system.name}`, { tick: getTick(), err: e });
        });
      }
    } catch (e) {
      logger.error(`[tick] system failed: ${system.name}`, { tick: getTick(), err: e });
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
      const tickStart = Date.now();
      runTickSystems();
      recordTick(Date.now() - tickStart, getActionQueueSize());
      lastUpdateTime += tickInterval;
      updates++;
    }

    const delay = Math.max(0, tickInterval - (Date.now() - lastUpdateTime));
    tickTimeout = setTimeout(tick, delay);
  };

  tick();

  return () => {
    running = false;
    if (tickTimeout) clearTimeout(tickTimeout);
  };
}
