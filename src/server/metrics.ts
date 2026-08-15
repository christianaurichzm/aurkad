import { getRuntimeState } from './services/world/gameData.js';
import { openConnectionCount } from './net/connections.js';
import { viewerCacheSizes } from './net/snapshot.js';
import { replicatedEntityCount } from './net/entityReplication.js';
import { rateLimiterEntryCount } from './net/transport.js';
import { dirtyPlayerCount } from './persistence/dirtyPlayers.js';
import { damageLedgerSize } from './services/combat/damage.js';
import {
  handlerCosts,
  scriptTimeShares,
} from './engine/scripting/handlerBudget.js';

export interface TickMetrics {
  tickMs: number;
  queueSize: number;
}

// 600 ticks = ~30 s at 20 Hz. The old 100-tick window held only ~5 s, which is
// too few samples for a meaningful p99 (it was effectively the max).
const WINDOW = 600;
const tickWindow: TickMetrics[] = Array.from({ length: WINDOW }, () => ({
  tickMs: 0,
  queueSize: 0,
}));
let tickHead = 0;
let tickFilled = 0;
let lastTickAt = 0;
let catchUpTicks = 0;
let totalTicks = 0;

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

// Wall-clock time of the last recorded tick; 0 before the loop starts.
// Used by the readiness probe to detect a stalled simulation loop.
export function getLastTickAt(): number {
  return lastTickAt;
}

// Nearest-rank percentile over the current window. `sorted` must be ascending.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx]!;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
    totalTicks,
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

  return {
    uptime: Math.floor(process.uptime()),
    wsConnections: openConnectionCount(),
    players: totalPlayers,
    npcs: totalNpcs,
    maps: maps.length,
    byMap,
    tick: getTickStats(),
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
    },
  };
}

// Test seam: the tick window is module-level state shared across tests.
export function resetMetricsForTest(): void {
  tickHead = 0;
  tickFilled = 0;
  lastTickAt = 0;
  catchUpTicks = 0;
  totalTicks = 0;
}
