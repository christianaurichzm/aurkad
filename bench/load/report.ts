// Aggregates a load run. Client numbers come from the bots and tick
// percentiles from scraping /metrics. Pure, so it is testable.

import { percentile } from '../../src/shared/utils.js';

export interface BotSample {
  bytesReceived: number;
  messagesReceived: number;
  worldUpdates: number;
  /** Register plus login; mostly password hashing, not engine work. */
  authMs: number;
  /** Socket open to first authoritative world state: the engine's part. */
  firstStateMs: number;
  errors: number;
}

export interface ServerSnapshot {
  tickP50: number;
  tickP95: number;
  tickP99: number;
  tickMax: number;
  playersOnline: number;
  wsConnections: number;
  bytesPerTick: number;
  bytesPerPlayerPerTick: number;
  deltaRatioPercent: number;
  actionQueueP95: number;
  /** Cumulative; the delta over a run is how many ticks fell behind. */
  catchUpTicks: number;
  rssBytes: number;
  heapUsedBytes: number;
  /** Entries held per player or per entity, by cache name. */
  caches: Record<string, number>;
}

export interface LoadReport {
  scenario: string;
  bots: number;
  connected: number;
  durationSeconds: number;
  bytesPerSecond: number;
  bytesPerBotPerSecond: number;
  messagesPerSecond: number;
  worldUpdatesPerBotPerSecond: number;
  auth: { p50: number; p95: number; max: number };
  firstState: { p50: number; p95: number; max: number };
  errors: number;
  server?: {
    tickP50: number;
    tickP95: number;
    tickP99: number;
    tickMax: number;
    playersOnline: number;
    bytesPerTick: number;
    bytesPerPlayerPerTick: number;
    deltaRatioPercent: number;
    actionQueueP95: number;
    /** Ticks that ran late during this run, not since boot. */
    catchUpTicks: number;
  };
}

export function buildReport(input: {
  scenario: string;
  requestedBots: number;
  samples: BotSample[];
  durationSeconds: number;
  before?: ServerSnapshot;
  after?: ServerSnapshot;
}): LoadReport {
  const { samples, durationSeconds } = input;
  const seconds = Math.max(durationSeconds, 0.001);
  const connected = samples.length;

  const totalBytes = sum(samples.map((s) => s.bytesReceived));
  const totalMessages = sum(samples.map((s) => s.messagesReceived));
  const totalWorldUpdates = sum(samples.map((s) => s.worldUpdates));
  const ascending = (a: number, b: number) => a - b;
  const authTimes = samples.map((s) => s.authMs).sort(ascending);
  const firstStateTimes = samples
    .map((s) => s.firstStateMs)
    .filter((ms) => ms > 0)
    .sort(ascending);

  const report: LoadReport = {
    scenario: input.scenario,
    bots: input.requestedBots,
    connected,
    durationSeconds: round(seconds, 1),
    bytesPerSecond: round(totalBytes / seconds),
    // The number to compare against a per-player egress budget. Zero connected
    // bots means no measurement, not zero bytes.
    bytesPerBotPerSecond: connected
      ? round(totalBytes / seconds / connected)
      : 0,
    messagesPerSecond: round(totalMessages / seconds),
    worldUpdatesPerBotPerSecond: connected
      ? round(totalWorldUpdates / seconds / connected, 2)
      : 0,
    auth: {
      p50: round(percentile(authTimes, 50)),
      p95: round(percentile(authTimes, 95)),
      max: round(Math.max(0, ...authTimes)),
    },
    firstState: {
      p50: round(percentile(firstStateTimes, 50)),
      p95: round(percentile(firstStateTimes, 95)),
      max: round(Math.max(0, ...firstStateTimes)),
    },
    errors: sum(samples.map((s) => s.errors)),
  };

  if (input.after) {
    report.server = {
      tickP50: round(input.after.tickP50, 2),
      tickP95: round(input.after.tickP95, 2),
      tickP99: round(input.after.tickP99, 2),
      tickMax: round(input.after.tickMax, 2),
      playersOnline: input.after.playersOnline,
      bytesPerTick: round(input.after.bytesPerTick),
      bytesPerPlayerPerTick: round(input.after.bytesPerPlayerPerTick),
      deltaRatioPercent: round(input.after.deltaRatioPercent, 1),
      actionQueueP95: round(input.after.actionQueueP95, 1),
      // Cumulative since boot, so only the delta belongs to this run.
      catchUpTicks: input.before
        ? Math.max(0, input.after.catchUpTicks - input.before.catchUpTicks)
        : input.after.catchUpTicks,
    };
  }

  return report;
}

/** Parses the OpenMetrics text /metrics returns. */
export function parseMetrics(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf(' ');
    if (sep <= 0) continue;
    const value = Number(line.slice(sep + 1).trim());
    if (Number.isFinite(value)) out[line.slice(0, sep)] = value;
  }
  return out;
}

export function toServerSnapshot(
  metrics: Record<string, number>,
): ServerSnapshot {
  return {
    tickP50: metrics['engine_tick_duration_ms_p50'] ?? 0,
    tickP95: metrics['engine_tick_duration_ms_p95'] ?? 0,
    tickP99: metrics['engine_tick_duration_ms_p99'] ?? 0,
    tickMax: metrics['engine_tick_duration_ms_max'] ?? 0,
    playersOnline: metrics['engine_players_online'] ?? 0,
    wsConnections: metrics['engine_ws_connections'] ?? 0,
    bytesPerTick: metrics['engine_net_bytes_per_tick_avg'] ?? 0,
    bytesPerPlayerPerTick:
      metrics['engine_net_bytes_per_player_per_tick_avg'] ?? 0,
    deltaRatioPercent: metrics['engine_net_delta_ratio_percent'] ?? 0,
    actionQueueP95: metrics['engine_action_queue_size_p95'] ?? 0,
    catchUpTicks: metrics['engine_tick_catchup_total'] ?? 0,
    rssBytes: metrics['engine_process_rss_bytes'] ?? 0,
    heapUsedBytes: metrics['engine_process_heap_used_bytes'] ?? 0,
    caches: Object.fromEntries(
      Object.entries(metrics)
        .filter(([name]) => name.startsWith('engine_cache_entries_'))
        .map(([name, value]) => [
          name.replace('engine_cache_entries_', ''),
          value,
        ]),
    ),
  };
}

export interface SoakSample {
  /** Milliseconds since the first sample. */
  atMs: number;
  server: ServerSnapshot;
}

/** Least-squares slope of y over x, in y-units per x-unit. */
function slope(points: Array<[number, number]>): number {
  const n = points.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
  }
  const denominator = n * sxx - sx * sx;
  return denominator === 0 ? 0 : (n * sxy - sx * sy) / denominator;
}

const mb = (bytes: number) => bytes / 1024 / 1024;

/**
 * Whether memory and per-player caches come back down. Memory per player
 * is measured against `baseline`, the scrape before any bot connected.
 */
export function formatSoak(
  samples: SoakSample[],
  baseline?: ServerSnapshot,
): string {
  if (samples.length < 2) return '\n  soak: not enough samples\n';

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const hours = (last.atMs - first.atMs) / 3_600_000;

  // Warm-up growth never repeats, so the slope skips the first 10% of samples.
  const warmup = samples.length > 4 ? Math.floor(samples.length * 0.1) : 0;
  const steady = samples.slice(warmup);
  const rssSlopePerHour =
    slope(steady.map((s) => [s.atMs / 3_600_000, mb(s.server.rssBytes)])) || 0;
  const heapSlopePerHour =
    slope(
      steady.map((s) => [s.atMs / 3_600_000, mb(s.server.heapUsedBytes)]),
    ) || 0;

  const players = samples.map((s) => s.server.playersOnline);
  const peakPlayers = Math.max(...players);
  const perPlayerMb =
    baseline && peakPlayers > 0
      ? (mb(last.server.rssBytes) - mb(baseline.rssBytes)) / peakPlayers
      : 0;

  const lines = [
    ``,
    `  soak`,
    `    duration          ${hours.toFixed(2)}h over ${samples.length} samples`,
    `    players           ${players[players.length - 1]} now, ${peakPlayers} peak`,
    `    rss               ${mb(first.server.rssBytes).toFixed(1)} MB -> ${mb(last.server.rssBytes).toFixed(1)} MB`,
    `    rss slope         ${rssSlopePerHour >= 0 ? '+' : ''}${rssSlopePerHour.toFixed(1)} MB/h   (after warm-up)`,
    `    heap used         ${mb(first.server.heapUsedBytes).toFixed(1)} MB -> ${mb(last.server.heapUsedBytes).toFixed(1)} MB`,
    `    heap slope        ${heapSlopePerHour >= 0 ? '+' : ''}${heapSlopePerHour.toFixed(1)} MB/h`,
  ];

  if (baseline) {
    lines.push(
      `    memory/player     ${perPlayerMb.toFixed(2)} MB   (rss now minus rss with no bots, over peak players)`,
    );
  }

  lines.push(
    ``,
    `    cache             first -> last   (players now: ${players[players.length - 1]})`,
  );
  for (const name of Object.keys(last.server.caches).sort()) {
    const from = first.server.caches[name] ?? 0;
    const to = last.server.caches[name] ?? 0;
    // A per-player cache above the online count after churn is a leak.
    const leaked =
      name.startsWith('viewer_') && to > players[players.length - 1]!;
    lines.push(
      `      ${name.padEnd(16)}${String(from).padStart(5)} ->${String(to).padStart(5)}${leaked ? '   <- above the online count' : ''}`,
    );
  }

  lines.push(``);
  return lines.join('\n');
}

/** The series behind the summary, for a chart or a second opinion. */
export function toSoakCsv(samples: SoakSample[]): string {
  const cacheNames = Object.keys(samples[0]?.server.caches ?? {}).sort();
  const header = [
    'seconds',
    'players',
    'rss_mb',
    'heap_used_mb',
    'tick_p50_ms',
    'tick_p99_ms',
    ...cacheNames.map((c) => `cache_${c}`),
  ].join(',');

  const rows = samples.map((s) =>
    [
      Math.round(s.atMs / 1000),
      s.server.playersOnline,
      mb(s.server.rssBytes).toFixed(2),
      mb(s.server.heapUsedBytes).toFixed(2),
      s.server.tickP50,
      s.server.tickP99,
      ...cacheNames.map((c) => s.server.caches[c] ?? 0),
    ].join(','),
  );

  return [header, ...rows].join('\n') + '\n';
}

export function formatReport(report: LoadReport): string {
  const lines = [
    ``,
    `  scenario            ${report.scenario}`,
    `  bots                ${report.connected}/${report.bots} connected` +
      (report.errors ? `  (${report.errors} errors)` : ''),
    `  duration            ${report.durationSeconds}s`,
    ``,
    `  client observed`,
    `    bytes/s           ${report.bytesPerSecond.toLocaleString()}`,
    `    bytes/bot/s       ${report.bytesPerBotPerSecond.toLocaleString()}`,
    `    messages/s        ${report.messagesPerSecond.toLocaleString()}`,
    `    updates/bot/s     ${report.worldUpdatesPerBotPerSecond}`,
    `    auth p50/p95      ${report.auth.p50}ms / ${report.auth.p95}ms   (password hashing, not the engine)`,
    `    first state p50   ${report.firstState.p50}ms   (socket open to first world update)`,
    `    first state p95   ${report.firstState.p95}ms`,
  ];

  if (report.server) {
    lines.push(
      ``,
      `  server reported`,
      `    tick p50/p95/p99  ${report.server.tickP50}ms / ${report.server.tickP95}ms / ${report.server.tickP99}ms`,
      `    tick max          ${report.server.tickMax}ms`,
      `    late ticks        ${report.server.catchUpTicks}` +
        (report.server.catchUpTicks > 0 ? '   <- the loop fell behind' : ''),
      `    players online    ${report.server.playersOnline}`,
      `    bytes/tick        ${report.server.bytesPerTick.toLocaleString()}`,
      `    bytes/player/tick ${report.server.bytesPerPlayerPerTick.toLocaleString()}`,
      `    delta ratio       ${report.server.deltaRatioPercent}%`,
      `    action queue p95  ${report.server.actionQueueP95}`,
    );
  } else {
    lines.push(
      ``,
      `  server metrics unavailable - pass --admin-user/--admin-pass to scrape`,
      `  tick percentiles (the number that decides whether 20 Hz is holding)`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
