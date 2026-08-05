import { Access } from '../../../shared/types.js';
import checkAccess from '../middleware/checkAccess.js';
import { getMetrics } from '../../metrics.js';
import { getNetStats } from '../../net/netStats.js';
import { createRouter } from '../../app.js';

type Sample = {
  name: string;
  help: string;
  type: 'gauge' | 'counter';
  value: number;
  /** One series per distinct set; the name is then shared, not repeated. */
  labels?: Record<string, string>;
};

/** Backslash, quote and newline: the three a label value may not carry raw. */
function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function renderLabels(labels: Record<string, string> | undefined): string {
  if (!labels) return '';
  const pairs = Object.entries(labels).map(
    ([key, value]) => `${key}="${escapeLabel(value)}"`,
  );
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`;
}

function render(samples: Sample[]): string {
  const lines: string[] = [];
  // HELP and TYPE describe the metric, not the series: emitting them again for
  // every labelled series is what a strict parser rejects.
  const described = new Set<string>();
  for (const s of samples) {
    if (!described.has(s.name)) {
      described.add(s.name);
      lines.push(`# HELP ${s.name} ${s.help}`);
      lines.push(`# TYPE ${s.name} ${s.type}`);
    }
    lines.push(`${s.name}${renderLabels(s.labels)} ${s.value}`);
  }
  return lines.join('\n') + '\n';
}

// Reads a numeric leaf out of the nested getNetStats() shape without widening
// its return type; missing keys degrade to 0 rather than emitting NaN.
function netNum(stats: Record<string, unknown>, path: string[]): number {
  let cur: unknown = stats;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return 0;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : 0;
}

export function buildMetricsSamples(): Sample[] {
  const m = getMetrics();
  const net = getNetStats();

  return [
    {
      name: 'engine_uptime_seconds',
      help: 'Process uptime in seconds.',
      type: 'gauge',
      value: m.uptime,
    },
    {
      name: 'engine_players_online',
      help: 'Players currently present in the world.',
      type: 'gauge',
      value: m.players,
    },
    {
      name: 'engine_npcs_active',
      help: 'NPCs currently instantiated across maps.',
      type: 'gauge',
      value: m.npcs,
    },
    {
      name: 'engine_maps_loaded',
      help: 'Maps loaded in this instance.',
      type: 'gauge',
      value: m.maps,
    },
    // Where the players are, not just how many: fan-out cost depends on how
    // many entities each viewer has in view, which the total cannot show.
    ...m.byMap.map((entry) => ({
      name: 'engine_players_by_map',
      help: 'Players present, per map.',
      type: 'gauge' as const,
      value: entry.players,
      labels: { map: entry.mapId },
    })),
    {
      name: 'engine_ws_connections',
      help: 'Open WebSocket connections.',
      type: 'gauge',
      value: m.wsConnections,
    },
    {
      name: 'engine_tick_duration_ms_avg',
      help: 'Mean simulation tick duration over the sample window.',
      type: 'gauge',
      value: m.tick.avgMs,
    },
    {
      name: 'engine_tick_duration_ms_p50',
      help: 'Median simulation tick duration over the sample window.',
      type: 'gauge',
      value: m.tick.p50Ms,
    },
    {
      name: 'engine_tick_duration_ms_p95',
      help: 'p95 simulation tick duration over the sample window.',
      type: 'gauge',
      value: m.tick.p95Ms,
    },
    {
      name: 'engine_tick_duration_ms_p99',
      help: 'p99 simulation tick duration over the sample window.',
      type: 'gauge',
      value: m.tick.p99Ms,
    },
    {
      name: 'engine_tick_duration_ms_max',
      help: 'Slowest simulation tick in the sample window.',
      type: 'gauge',
      value: m.tick.maxMs,
    },
    {
      name: 'engine_tick_samples',
      help: 'Ticks currently held in the sample window.',
      type: 'gauge',
      value: m.tick.samples,
    },
    {
      name: 'engine_ticks_total',
      help: 'Ticks executed since process start.',
      type: 'counter',
      value: m.tick.totalTicks,
    },
    {
      name: 'engine_tick_catchup_total',
      help: 'Ticks run to catch up after the loop fell behind.',
      type: 'counter',
      value: m.tick.catchUpTicks,
    },
    {
      name: 'engine_action_queue_size_avg',
      help: 'Mean pending action-queue size over the sample window.',
      type: 'gauge',
      value: m.tick.avgQueueSize,
    },
    {
      name: 'engine_action_queue_size_p95',
      help: 'p95 pending action-queue size over the sample window.',
      type: 'gauge',
      value: m.tick.p95QueueSize,
    },
    {
      name: 'engine_action_queue_size_max',
      help: 'Largest pending action-queue size in the sample window.',
      type: 'gauge',
      value: m.tick.maxQueueSize,
    },
    {
      name: 'engine_net_bytes_per_tick_avg',
      help: 'Mean bytes broadcast per tick over the netStats window.',
      type: 'gauge',
      value: netNum(net, ['bandwidth', 'avgBytesPerTick']),
    },
    {
      name: 'engine_net_bytes_per_player_per_tick_avg',
      help: 'Mean bytes broadcast per player per tick.',
      type: 'gauge',
      value: netNum(net, ['bandwidth', 'avgBytesPerPlayerPerTick']),
    },
    {
      name: 'engine_net_delta_ratio_percent',
      help: 'Share of dynamic snapshots sent as deltas rather than full states.',
      type: 'gauge',
      value: netNum(net, ['dynamicSnapshots', 'deltaRatioPercent']),
    },
    {
      name: 'engine_net_full_state_size_bytes_avg',
      help: 'Mean size of a full game-state message.',
      type: 'gauge',
      value: netNum(net, ['dynamicSnapshots', 'avgFullStateSizeBytes']),
    },
    {
      name: 'engine_net_delta_size_bytes_avg',
      help: 'Mean size of a delta message.',
      type: 'gauge',
      value: netNum(net, ['dynamicSnapshots', 'avgDeltaSizeBytes']),
    },
    // Memory and per-player caches: a soak reads these as a slope, and the
    // cache counts are what turn "it grows" into "this map grows".
    {
      name: 'engine_process_rss_bytes',
      help: 'Resident set size of the server process.',
      type: 'gauge',
      value: m.memory.rss,
    },
    {
      name: 'engine_process_heap_used_bytes',
      help: 'V8 heap in use.',
      type: 'gauge',
      value: m.memory.heapUsed,
    },
    {
      name: 'engine_process_heap_total_bytes',
      help: 'V8 heap reserved.',
      type: 'gauge',
      value: m.memory.heapTotal,
    },
    {
      name: 'engine_process_external_bytes',
      help: 'Memory held outside the V8 heap (buffers, sockets).',
      type: 'gauge',
      value: m.memory.external,
    },
    ...(
      [
        ['viewer_cold', m.caches.viewerCold, 'cold state last sent per viewer'],
        [
          'viewer_drops',
          m.caches.viewerDrops,
          'dropped items last sent per viewer',
        ],
        [
          'viewer_self',
          m.caches.viewerSelf,
          'self payload last sent per viewer',
        ],
        ['viewer_chunks', m.caches.viewerChunks, 'map chunk state per viewer'],
        ['viewer_interest', m.caches.viewerInterest, 'interest set per viewer'],
        [
          'replication',
          m.caches.replication,
          'entities holding a diff baseline',
        ],
        [
          'rate_limit',
          m.caches.rateLimit,
          'rate-limiter entries per connection',
        ],
        ['dirty_players', m.caches.dirtyPlayers, 'players awaiting a write'],
        [
          'damage_ledger',
          m.caches.damageLedger,
          'entities tracking who damaged them',
        ],
      ] as const
    ).map(([key, value, help]) => ({
      name: `engine_cache_entries_${key}`,
      help: `Entries held in the ${help.replace(/\.$/, '')} cache.`,
      type: 'gauge' as const,
      value,
    })),
    // Who inside the sandbox is spending the frame. The tick percentiles above
    // say the server got slower; these say which file to open.
    ...m.scripts.handlers.flatMap((h) => [
      {
        name: 'engine_script_handler_ms_total',
        help: 'Time spent inside a script handler since its script loaded.',
        type: 'counter' as const,
        value: h.totalMs,
        labels: { script: h.script, handler: h.handler },
      },
      {
        name: 'engine_script_handler_calls_total',
        help: 'Times a script handler has been invoked since its script loaded.',
        type: 'counter' as const,
        value: h.calls,
        labels: { script: h.script, handler: h.handler },
      },
    ]),
    ...m.scripts.shares.map((s) => ({
      name: 'engine_script_wallclock_percent',
      help: 'Share of wall-clock time a script took in the last complete measurement window.',
      type: 'gauge' as const,
      value: s.percent,
      labels: { script: s.script },
    })),
  ];
}

// OpenMetrics/Prometheus scrape endpoint. Admin-gated: the same numbers are a
// capacity map of the server, and this is not a public health probe (see
// healthRoutes for those). Point a scraper at it with an operator session, or
// expose it only on an internal network.
export function createMetricsRouter() {
  const router = createRouter();

  router.get('/metrics', checkAccess(Access.ADMIN), (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(render(buildMetricsSamples()));
  });

  return router;
}
