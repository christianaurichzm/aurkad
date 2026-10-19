/**
 * The arithmetic a load run is read through. A wrong divisor here would
 * show up as a bogus conclusion about the engine, not as a harness bug.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReport,
  formatSoak,
  parseMetrics,
  toServerSnapshot,
  toSoakCsv,
  type BotSample,
  type ServerSnapshot,
  type SoakSample,
} from './report.js';

const serverSnapshot = (
  over: Partial<ServerSnapshot> = {},
): ServerSnapshot => ({
  tickP50: 0,
  tickP95: 0,
  tickP99: 0,
  tickMax: 0,
  playersOnline: 0,
  wsConnections: 0,
  bytesPerTick: 0,
  bytesPerPlayerPerTick: 0,
  deltaRatioPercent: 0,
  actionQueueP95: 0,
  catchUpTicks: 0,
  rssBytes: 0,
  heapUsedBytes: 0,
  caches: {},
  ...over,
});

const MB = 1024 * 1024;

const sample = (over: Partial<BotSample> = {}): BotSample => ({
  bytesReceived: 0,
  messagesReceived: 0,
  worldUpdates: 0,
  authMs: 0,
  firstStateMs: 0,
  errors: 0,
  ...over,
});

describe('buildReport', () => {
  it('reports latency percentiles whatever order the bots finished in', () => {
    const report = buildReport({
      scenario: 'test',
      requestedBots: 5,
      samples: [9, 1, 5, 3, 7].map((authMs) => sample({ authMs })),
      durationSeconds: 1,
    });
    expect(report.auth.p50).toBe(5);
  });

  it('divides totals by the measured window and the bots that connected', () => {
    const report = buildReport({
      scenario: 'test',
      requestedBots: 10,
      samples: [
        sample({ bytesReceived: 1000, messagesReceived: 20, worldUpdates: 20 }),
        sample({ bytesReceived: 3000, messagesReceived: 60, worldUpdates: 60 }),
      ],
      durationSeconds: 2,
    });

    expect(report.bytesPerSecond).toBe(2000);
    expect(report.bytesPerBotPerSecond).toBe(1000);
    expect(report.messagesPerSecond).toBe(40);
    expect(report.worldUpdatesPerBotPerSecond).toBe(20);
  });

  // Divides by connected bots, since bots that never got in would
  // understate the per-player cost.
  it('reports connected and requested separately', () => {
    const report = buildReport({
      scenario: 'test',
      requestedBots: 100,
      samples: [sample({ bytesReceived: 500 })],
      durationSeconds: 1,
    });

    expect(report.bots).toBe(100);
    expect(report.connected).toBe(1);
    expect(report.bytesPerBotPerSecond).toBe(500);
  });

  it('reports zero rather than dividing by nothing when no bot connected', () => {
    const report = buildReport({
      scenario: 'test',
      requestedBots: 10,
      samples: [],
      durationSeconds: 5,
    });

    expect(report.bytesPerBotPerSecond).toBe(0);
    expect(report.worldUpdatesPerBotPerSecond).toBe(0);
    expect(Number.isNaN(report.bytesPerSecond)).toBe(false);
  });

  it('sums errors across bots', () => {
    const report = buildReport({
      scenario: 'test',
      requestedBots: 3,
      samples: [sample({ errors: 2 }), sample({ errors: 1 }), sample()],
      durationSeconds: 1,
    });

    expect(report.errors).toBe(3);
  });

  // Auth is mostly password hashing and first state is the engine, so they
  // are reported apart.
  it('summarises auth and first-state latency separately', () => {
    const report = buildReport({
      scenario: 'test',
      requestedBots: 4,
      samples: [
        sample({ authMs: 4000, firstStateMs: 30 }),
        sample({ authMs: 4100, firstStateMs: 40 }),
        sample({ authMs: 4200, firstStateMs: 50 }),
        sample({ authMs: 4300, firstStateMs: 900 }),
      ],
      durationSeconds: 1,
    });

    expect(report.auth.p50).toBe(4100);
    expect(report.auth.max).toBe(4300);
    expect(report.firstState.p50).toBe(40);
    expect(report.firstState.max).toBe(900);
  });

  // A bot that never got world state has no first-state time to count.
  it('ignores bots that never got world state when timing first state', () => {
    const report = buildReport({
      scenario: 'test',
      requestedBots: 4,
      samples: [
        sample({ firstStateMs: 100 }),
        sample({ firstStateMs: 0 }),
        sample({ firstStateMs: 120 }),
        sample({ firstStateMs: 140 }),
      ],
      durationSeconds: 1,
    });

    // Counting the zero would put the median at 100 instead.
    expect(report.firstState.p50).toBe(120);
  });

  it('omits the server section when metrics could not be scraped', () => {
    const report = buildReport({
      scenario: 'test',
      requestedBots: 1,
      samples: [sample()],
      durationSeconds: 1,
    });

    expect(report.server).toBeUndefined();
  });

  // Late ticks count since boot, so only this run's delta is reported.
  it('reports only the late ticks that happened during the run', () => {
    const snapshot = (catchUpTicks: number) => ({
      tickP50: 5,
      tickP95: 9,
      tickP99: 12,
      tickMax: 30,
      playersOnline: 100,
      wsConnections: 100,
      bytesPerTick: 5000,
      bytesPerPlayerPerTick: 50,
      deltaRatioPercent: 80,
      actionQueueP95: 3,
      catchUpTicks,
      rssBytes: 0,
      heapUsedBytes: 0,
      caches: {},
    });

    const report = buildReport({
      scenario: 'test',
      requestedBots: 1,
      samples: [sample()],
      durationSeconds: 10,
      before: snapshot(900),
      after: snapshot(912),
    });

    expect(report.server?.catchUpTicks).toBe(12);
  });

  it('passes through the tick percentiles that decide whether 20 Hz holds', () => {
    const after = {
      tickP50: 4.44,
      tickP95: 18.75,
      tickP99: 41.2,
      tickMax: 96.5,
      playersOnline: 500,
      wsConnections: 500,
      bytesPerTick: 120000,
      bytesPerPlayerPerTick: 240,
      deltaRatioPercent: 91.4,
      actionQueueP95: 7,
      catchUpTicks: 0,
      rssBytes: 0,
      heapUsedBytes: 0,
      caches: {},
    };

    const report = buildReport({
      scenario: 'L3',
      requestedBots: 500,
      samples: [sample()],
      durationSeconds: 60,
      after,
    });

    expect(report.server).toMatchObject({
      tickP50: 4.44,
      tickP95: 18.75,
      tickP99: 41.2,
      playersOnline: 500,
      bytesPerPlayerPerTick: 240,
      deltaRatioPercent: 91.4,
    });
  });
});

describe('parseMetrics', () => {
  it('reads name/value pairs and skips the comment lines', () => {
    const text = [
      '# HELP engine_tick_duration_ms_p95 tick p95',
      '# TYPE engine_tick_duration_ms_p95 gauge',
      'engine_tick_duration_ms_p95 12.5',
      'engine_players_online 42',
      '',
    ].join('\n');

    expect(parseMetrics(text)).toEqual({
      engine_tick_duration_ms_p95: 12.5,
      engine_players_online: 42,
    });
  });

  it('drops a line whose value is not a number', () => {
    expect(parseMetrics('engine_thing not_a_number\n')).toEqual({});
  });

  it('handles empty input', () => {
    expect(parseMetrics('')).toEqual({});
  });
});

describe('toServerSnapshot', () => {
  it('maps the metric names the server actually exposes', () => {
    const snapshot = toServerSnapshot({
      engine_tick_duration_ms_p50: 3,
      engine_tick_duration_ms_p95: 8,
      engine_tick_duration_ms_p99: 15,
      engine_tick_duration_ms_max: 60,
      engine_players_online: 120,
      engine_ws_connections: 121,
      engine_net_bytes_per_tick_avg: 90000,
      engine_net_bytes_per_player_per_tick_avg: 750,
      engine_net_delta_ratio_percent: 88,
      engine_action_queue_size_p95: 4,
      engine_tick_catchup_total: 17,
    });

    expect(snapshot.tickP95).toBe(8);
    expect(snapshot.bytesPerPlayerPerTick).toBe(750);
    expect(snapshot.catchUpTicks).toBe(17);
  });

  // A missing metric reads as zero rather than NaN.
  it('defaults a missing metric to zero', () => {
    const snapshot = toServerSnapshot({});
    expect(snapshot.tickP95).toBe(0);
    expect(snapshot.catchUpTicks).toBe(0);
  });
});

// The soak verdict rests on this arithmetic: a wrong slope invents or
// hides a leak.
describe('soak summary', () => {
  const series = (
    points: Array<[number, Partial<ServerSnapshot>]>,
  ): SoakSample[] =>
    points.map(([minutes, over]) => ({
      atMs: minutes * 60_000,
      server: serverSnapshot(over),
    }));

  it('reports growth as MB per hour, not as a total', () => {
    // 30 MB gained over half an hour is 60 MB/h, whatever the sample count.
    const samples = series([
      [0, { rssBytes: 100 * MB, playersOnline: 150 }],
      [15, { rssBytes: 115 * MB, playersOnline: 150 }],
      [30, { rssBytes: 130 * MB, playersOnline: 150 }],
    ]);

    expect(formatSoak(samples)).toContain('+60.0 MB/h');
  });

  it('reads a flat run as no slope', () => {
    const samples = series([
      [0, { rssBytes: 200 * MB }],
      [30, { rssBytes: 200 * MB }],
      [60, { rssBytes: 200 * MB }],
    ]);

    expect(formatSoak(samples)).toContain('+0.0 MB/h');
  });

  it('measures memory per player against the run with no bots', () => {
    const baseline = serverSnapshot({ rssBytes: 100 * MB, playersOnline: 0 });
    const samples = series([
      [0, { rssBytes: 130 * MB, playersOnline: 100 }],
      [60, { rssBytes: 150 * MB, playersOnline: 100 }],
    ]);

    // 150 MB now minus 100 MB idle, over 100 players.
    expect(formatSoak(samples, baseline)).toContain('0.50 MB');
  });

  it('flags a per-viewer cache left above the online count', () => {
    const samples = series([
      [0, { playersOnline: 150, caches: { viewer_self: 150 } }],
      [60, { playersOnline: 150, caches: { viewer_self: 900 } }],
    ]);

    expect(formatSoak(samples)).toContain('above the online count');
  });

  it('says nothing when the caches drain with the players', () => {
    const samples = series([
      [0, { playersOnline: 150, caches: { viewer_self: 150 } }],
      [60, { playersOnline: 150, caches: { viewer_self: 150 } }],
    ]);

    expect(formatSoak(samples)).not.toContain('above the online count');
  });

  it('writes one CSV row per sample, with a column per cache', () => {
    const csv = toSoakCsv(
      series([
        [0, { rssBytes: 100 * MB, caches: { viewer_self: 1, replication: 2 } }],
        [1, { rssBytes: 101 * MB, caches: { viewer_self: 3, replication: 4 } }],
      ]),
    );
    const [header, ...rows] = csv.trim().split('\n');

    expect(header).toContain('cache_replication');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('101.00');
  });
});

// Warm-up growth never repeats, so fitting through it reports a false leak.
describe('soak warm-up', () => {
  it('ignores the opening samples when fitting the slope', () => {
    const samples: SoakSample[] = [
      // A 100 MB jump in the first minute, then perfectly flat for an hour.
      { atMs: 0, server: serverSnapshot({ rssBytes: 100 * MB }) },
      { atMs: 60_000, server: serverSnapshot({ rssBytes: 200 * MB }) },
      ...Array.from({ length: 10 }, (_, i) => ({
        atMs: (i + 2) * 300_000,
        server: serverSnapshot({ rssBytes: 200 * MB }),
      })),
    ];

    expect(formatSoak(samples)).toContain('+0.0 MB/h');
  });
});
