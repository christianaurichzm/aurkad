import { getRuntimeState } from './sim/world.js';
import { openConnectionCount } from './net/connections.js';
import { viewerCacheSizes } from './net/viewerState.js';
import { replicatedEntityCount } from './net/entityReplication.js';
import { rateLimiterEntryCount } from './net/transport.js';
import { dirtyPlayerCount } from './persistence/dirtyPlayers.js';
import { damageLedgerSize } from './services/combat/damage.js';
import { attackCooldownCount } from './services/combat/attackCooldown.js';
import { npcAiStateCount } from './services/npc/aiBrain.js';
import { movementStateCounts } from './services/world/movementService.js';
import { entranceCount } from './services/world/instanceService.js';
import {
  handlerCosts,
  scriptTimeShares,
} from './engine/scripting/handlerBudget.js';
import { tracingStats } from './tracing.js';
import { percentile, round2 } from '../shared/utils.js';
import { PerformanceObserver, constants } from 'node:perf_hooks';

export interface TickMetrics {
  tickMs: number;
  queueSize: number;
}

// 600 ticks is ~30 s at 20 Hz, enough samples for a p99 that is not the max.
const WINDOW = 600;
const tickWindow: TickMetrics[] = Array.from({ length: WINDOW }, () => ({
  tickMs: 0,
  queueSize: 0,
}));
let tickHead = 0;
let tickFilled = 0;
let lastTickAt = 0;
let catchUpTicks = 0;
let droppedTicks = 0;
let totalTicks = 0;

// Milliseconds each tick system has spent since start, by name. The tick
// percentiles say the frame got slower; this says which part of it.
const systemMs = new Map<string, number>();

// Collector pauses by kind, since start. A major collection stops the world
// mid-tick and its time lands on whichever system happened to be running, so
// the per-system totals cannot tell a slow system from an unlucky one; this
// can. Observed from load: a counter has to cover the whole process lifetime.
const GC_KINDS: Record<number, string> = {
  [constants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
  [constants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
  [constants.NODE_PERFORMANCE_GC_WEAKCB]: 'weakcb',
};
const gcMs = new Map<string, number>();
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const { detail } = entry as PerformanceEntry & {
      detail?: { kind?: number };
    };
    const kind = GC_KINDS[detail?.kind ?? -1] ?? 'other';
    gcMs.set(kind, (gcMs.get(kind) ?? 0) + entry.duration);
  }
}).observe({ entryTypes: ['gc'] });

export function recordTick(ms: number, queueSize: number): void {
  tickWindow[tickHead] = { tickMs: ms, queueSize };
  tickHead = (tickHead + 1) % WINDOW;
  if (tickFilled < WINDOW) tickFilled++;
  lastTickAt = Date.now();
  totalTicks++;
}

// A tick the loop had to run to catch up (more than one update in a timer
// fire). A rising rate means the loop is not keeping pace with the tick rate.
export function recordCatchUpTick(): void {
  catchUpTicks++;
}

// Ticks the loop let go instead of running late: owed past its backlog cap.
export function recordDroppedTicks(count: number): void {
  droppedTicks += count;
}

export function recordSystemTime(name: string, ms: number): void {
  systemMs.set(name, (systemMs.get(name) ?? 0) + ms);
}

// Wall-clock time of the last recorded tick; 0 before the loop starts.
// Used by the readiness probe to detect a stalled simulation loop.
export function getLastTickAt(): number {
  return lastTickAt;
}

export function getTickStats() {
  const ms: number[] = [];
  const queue: number[] = [];
  let sumTickMs = 0;
  let sumQueueSize = 0;

  for (let i = 0; i < tickFilled; i++) {
    const entry = tickWindow[i]!;
    ms.push(entry.tickMs);
    queue.push(entry.queueSize);
    sumTickMs += entry.tickMs;
    sumQueueSize += entry.queueSize;
  }

  ms.sort((a, b) => a - b);
  queue.sort((a, b) => a - b);

  return {
    samples: tickFilled,
    avgMs: tickFilled === 0 ? 0 : round2(sumTickMs / tickFilled),
    p50Ms: round2(percentile(ms, 50)),
    p95Ms: round2(percentile(ms, 95)),
    p99Ms: round2(percentile(ms, 99)),
    maxMs: round2(ms[ms.length - 1] ?? 0),
    avgQueueSize:
      tickFilled === 0 ? 0 : Math.round((sumQueueSize / tickFilled) * 10) / 10,
    p95QueueSize: percentile(queue, 95),
    maxQueueSize: queue[queue.length - 1] ?? 0,
    catchUpTicks,
    droppedTicks,
    totalTicks,
    systems: [...systemMs].map(([system, totalMs]) => ({
      system,
      totalMs: round2(totalMs),
    })),
  };
}

export function getMetrics() {
  const state = getRuntimeState();
  const maps = Object.values(state.maps);

  let totalPlayers = 0;
  let totalNpcs = 0;
  // Per map as well as in total, because the total cannot answer the question
  // an operator actually has under load: a thousand players spread over twenty
  // maps and a thousand standing on one tile are the same number here and
  // nothing alike to the fan-out, which is per viewer and per entity in view.
  // Cardinality is bounded by the map registry, not by traffic.
  const byMap: Array<{ mapId: string; players: number; npcs: number }> = [];
  for (const map of maps) {
    const players = Object.keys(map.players).length;
    const npcs = Object.keys(map.npcs).length;
    totalPlayers += players;
    totalNpcs += npcs;
    byMap.push({ mapId: map.id, players, npcs });
  }

  const memory = process.memoryUsage();
  const viewers = viewerCacheSizes();
  const movement = movementStateCounts();

  return {
    uptime: Math.floor(process.uptime()),
    wsConnections: openConnectionCount(),
    players: totalPlayers,
    npcs: totalNpcs,
    maps: maps.length,
    byMap,
    tick: getTickStats(),
    gc: [...gcMs].map(([kind, totalMs]) => ({
      kind,
      totalMs: round2(totalMs),
    })),
    // Read straight from the process rather than sampled into a window: a soak
    // reads memory as a slope over hours, and the sampling belongs to whoever
    // is scraping, not here.
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
    },
    // What the sandbox costs, and to whom. The handler budget catches one slow
    // call; this is the volume it cannot see, which is the shape a per-tick
    // sweep in a module has.
    scripts: {
      handlers: handlerCosts(),
      shares: scriptTimeShares(),
    },
    // A span that never reached the collector is invisible by definition: the
    // trace it belonged to simply has a hole where this process should be, and
    // that reads as "nothing happened here" rather than as a lost export.
    tracing: tracingStats(),
    // Every one of these is keyed by a player or an entity that eventually goes
    // away. Published together because "does it leak" is answered by comparing
    // them with the online count, and "which one leaks" needs them separate.
    caches: {
      viewerCold: viewers.cold,
      viewerDrops: viewers.drops,
      viewerSelf: viewers.self,
      viewerChunks: viewers.chunks,
      viewerInterest: viewers.interest,
      replication: replicatedEntityCount(),
      rateLimit: rateLimiterEntryCount(),
      dirtyPlayers: dirtyPlayerCount(),
      damageLedger: damageLedgerSize(),
      npcAi: npcAiStateCount(),
      attackCooldown: attackCooldownCount(),
      heldKeys: movement.heldKeys,
      pathGoals: movement.pathGoals,
      instanceEntrances: entranceCount(),
    },
  };
}

// Test seam: the tick window is module-level state shared across tests.
export function resetMetricsForTest(): void {
  tickHead = 0;
  tickFilled = 0;
  lastTickAt = 0;
  catchUpTicks = 0;
  droppedTicks = 0;
  totalTicks = 0;
  systemMs.clear();
}
