import { Worker } from 'node:worker_threads';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  recordTick,
  recordCatchUpTick,
  recordDroppedTicks,
  recordSystemTime,
} from '../metrics.js';
import {
  processMovementIntent,
  processMovementCompletion,
} from '../services/world/movementService.js';
import { rebuildQuadtree } from './spatialManager.js';
import { getRuntimeState } from './world.js';
import { processActions, getActionQueueSize } from '../net/transport.js';
import { updateDueNpcs } from '../services/npc/index.js';
import { regenerateHealth } from '../services/combat/index.js';
import { emitInventoryChanges } from '../services/economy/inventoryService.js';
import { broadcastGameState } from '../net/snapshot.js';
import { flushGameEvents } from '../net/fanout.js';
import { advanceTick, getTick } from './clock.js';
import { runScheduledTasks } from './scheduler.js';
import { emit } from '../engine/hooks.js';

type TimeoutHandle = ReturnType<typeof setTimeout>;

function rebuildSpatialIndexes() {
  try {
    const state = getRuntimeState();
    if (!state?.maps) return;

    for (const [mapId, map] of Object.entries(state.maps)) {
      if (map?.players && map.npcs) {
        rebuildQuadtree(mapId, map);
      }
    }
  } catch (err) {
    logger.error('[spatial] Failed to rebuild quadtree', {
      tick: getTick(),
      err,
    });
  }
}

// Per-tick hook for scripts and modules. Runs after movement so the world
// is settled, and before the flush so handler output ships this tick.
function emitTick() {
  emit('tick', { tick: getTick() });
}

type TickSystem = { name: string; run: () => unknown };

// The frame contract. The sim fixture steps through this same list, so a test
// sees systems in the order the server runs them.
export const tickSystems: readonly TickSystem[] = [
  { name: 'advanceTick', run: advanceTick },
  { name: 'rebuildSpatialIndexes', run: rebuildSpatialIndexes },
  { name: 'processActions', run: processActions },
  // After the players' input, so within a tick players act before npcs.
  { name: 'updateNpcs', run: updateDueNpcs },
  { name: 'regenerateHealth', run: regenerateHealth },
  { name: 'processMovementCompletion', run: processMovementCompletion },
  { name: 'processMovementIntent', run: processMovementIntent },
  // After the tick's input, so a handler sees each bag as this tick left it.
  { name: 'inventoryChanges', run: emitInventoryChanges },
  // Same slot as the tick hook, for the same reason. Runs first so tasks can
  // set up state the tick handlers read.
  { name: 'runScheduledTasks', run: runScheduledTasks },
  { name: 'tickHook', run: emitTick },
  { name: 'flushGameEvents', run: flushGameEvents },
  { name: 'broadcastGameState', run: broadcastGameState },
];

function systemFailed(name: string, err: unknown) {
  logger.errorThrottled(`tick:${name}`, `[tick] system failed: ${name}`, {
    tick: getTick(),
    err,
  });
}

function runTickSystems() {
  for (const system of tickSystems) {
    const startedAt = performance.now();
    try {
      const result = system.run();
      if (result instanceof Promise) {
        result.catch((e) => systemFailed(system.name, e));
      }
    } catch (e) {
      systemFailed(system.name, e);
    }
    recordSystemTime(system.name, performance.now() - startedAt);
  }
}

// Lag the loop still catches up on, a few ticks per fire. Past this the
// extra ticks are dropped instead of fast-forwarding the world.
const MAX_BACKLOG_MS = 250;

// Bumped on every loop fire, read by the watchdog thread.
const heartbeat = new Int32Array(new SharedArrayBuffer(4));

export function startGameLoops(): () => void {
  const TICK_RATE = config.gameLoop.tickRate;
  const MAX_UPDATES_PER_TICK = config.gameLoop.maxUpdatesPerTick;

  const tickInterval = 1000 / TICK_RATE;
  // Monotonic, so an NTP step back doesn't delay the next fire.
  let lastUpdateTime = performance.now();
  let running = true;
  let tickTimeout: TimeoutHandle | undefined;

  const tick = () => {
    if (!running) return;
    Atomics.add(heartbeat, 0, 1);
    const now = performance.now();

    const excess = now - lastUpdateTime - MAX_BACKLOG_MS;
    if (excess > 0) {
      const dropped = Math.ceil(excess / tickInterval);
      lastUpdateTime += dropped * tickInterval;
      recordDroppedTicks(dropped);
    }

    let updates = 0;
    while (
      now - lastUpdateTime >= tickInterval &&
      updates < MAX_UPDATES_PER_TICK
    ) {
      const tickStart = performance.now();
      runTickSystems();
      recordTick(performance.now() - tickStart, getActionQueueSize());
      // Every update past the first in one timer fire is the loop catching up.
      if (updates > 0) recordCatchUpTick();
      lastUpdateTime += tickInterval;
      updates++;
    }

    const delay = Math.max(
      0,
      tickInterval - (performance.now() - lastUpdateTime),
    );
    tickTimeout = setTimeout(tick, delay);
  };

  tick();

  return () => {
    running = false;
    if (tickTimeout) clearTimeout(tickTimeout);
  };
}

/**
 * Watchdog thread source. A handler that never returns freezes the main
 * thread, so this thread watches the heartbeat and, after `stallMs` without
 * a beat, logs the stuck stack via the inspector and kills the process for
 * the supervisor to restart.
 *
 * Plain CommonJS in a string so it needs no TS loader or build output. It
 * writes to fd 2 because a worker's console goes through the main thread.
 */
export const WATCHDOG_SOURCE = `
const { workerData } = require('node:worker_threads');
const { Session } = require('node:inspector');
const { writeSync } = require('node:fs');
const beat = new Int32Array(workerData.heartbeat);
let seen = Atomics.load(beat, 0);
let movedAt = performance.now();

function exit(stalledMs, stack) {
  const msg = '[tick] loop stalled; exiting for the supervisor to restart';
  const ctx = { stalledMs: Math.round(stalledMs), stack };
  const line = workerData.json
    ? JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg, ...ctx })
    : '[ERROR] ' + msg + ' ' + JSON.stringify(ctx);
  writeSync(2, line + '\\n');
  process.kill(process.pid, 'SIGKILL');
}

const poll = setInterval(() => {
  const now = Atomics.load(beat, 0);
  if (now !== seen) {
    seen = now;
    movedAt = performance.now();
    return;
  }
  const stalledMs = performance.now() - movedAt;
  if (stalledMs < workerData.stallMs) return;
  clearInterval(poll);

  // A thread blocked outside JavaScript never reaches a pause point.
  const fallback = setTimeout(() => exit(stalledMs, []), 2000);
  const urls = new Map();
  const session = new Session();
  session.connectToMainThread();
  session.on('Debugger.scriptParsed', ({ params }) => {
    urls.set(params.scriptId, params.url);
  });
  session.on('Debugger.paused', ({ params }) => {
    clearTimeout(fallback);
    exit(
      stalledMs,
      params.callFrames.slice(0, 10).map((f) =>
        (f.functionName || '<anonymous>') + ' ' +
        (urls.get(f.location.scriptId) || '?') + ':' +
        (f.location.lineNumber + 1),
      ),
    );
  });
  session.post('Debugger.enable', () => session.post('Debugger.pause'));
}, 1000);
`;

/** Starts the watchdog thread over the loop's heartbeat; returns its stop. */
export function startTickWatchdog(stallMs: number): () => void {
  const worker = new Worker(WATCHDOG_SOURCE, {
    eval: true,
    execArgv: [],
    workerData: {
      heartbeat: heartbeat.buffer,
      stallMs,
      json: process.env.NODE_ENV === 'production',
    },
  });
  worker.unref();
  return () => {
    void worker.terminate();
  };
}
