// Aggregates a load run. Client numbers come from the bots and tick
// percentiles from scraping /metrics. Pure, so it is testable.

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

/**
 * Nearest-rank percentile. No interpolation, so every value reported is one
 * a tick or a login actually took, which makes "p95 was 41ms" a statement
 * about the run rather than the estimator.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
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
  const authTimes = samples.map((s) => s.authMs);
  const firstStateTimes = samples
    .map((s) => s.firstStateMs)
    .filter((ms) => ms > 0);

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
  };
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
