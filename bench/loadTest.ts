// Headless load harness. Needs a running server (npm run dev) and its
// database, and uses the same HTTP and WebSocket path as the browser.
//
//   npm run loadtest -- --scenario=L3
//   npm run loadtest -- --bots=200 --duration=60 --behavior=wander
//   npm run loadtest -- --scenario=L1 --admin-user=root --admin-pass=secret
//
// Soak, memory over time:
//
//   npm run loadtest -- --bots=150 --behavior=reconnect --duration=3600 \
//     --sample-every=30 --csv=soak.csv --admin-user=root --admin-pass=secret
//
// Bots on the server's machine compete with it, so treat those numbers as a
// floor. Every bot comes from one address, so raise AUTH_RATE_LIMIT_MAX
// and HTTP_RATE_LIMIT_MAX on the server first.

import { LoadBot } from './load/bot.js';
import {
  SCENARIOS,
  findScenario,
  type BotBehavior,
  type Scenario,
} from './load/scenarios.js';
import { writeFileSync } from 'node:fs';
import {
  buildReport,
  formatReport,
  formatSoak,
  parseMetrics,
  toServerSnapshot,
  toSoakCsv,
  type ServerSnapshot,
  type SoakSample,
} from './load/report.js';
import {
  applyPlacements,
  assessWorld,
  fetchMaps,
  planGathering,
  planPlacements,
  summarizeDistribution,
} from './load/spread.js';

const args = process.argv.slice(2);
const argOf = (name: string): string | undefined =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const baseUrl = (argOf('url') ?? 'http://localhost:8080').replace(/\/$/, '');
const prefix = argOf('prefix') ?? 'loadbot';
const password = argOf('password') ?? 'loadbot-password';
const adminUser = argOf('admin-user');
const adminPass = argOf('admin-pass');
const jsonOut = hasFlag('json');

// Seeded, so two runs of a scenario drive the same input sequence.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveScenario(): Scenario {
  const id = argOf('scenario');
  if (id) {
    const found = findScenario(id);
    if (!found) {
      console.error(
        `Unknown scenario "${id}". Known: ${SCENARIOS.map((s) => s.id).join(', ')}`,
      );
      process.exit(1);
    }
    return applyOverrides(found);
  }
  return applyOverrides({
    id: 'custom',
    description: 'ad-hoc run',
    bots: 50,
    behavior: 'wander',
    durationSeconds: 30,
    watch: 'whatever you pointed it at',
  });
}

function applyOverrides(scenario: Scenario): Scenario {
  const bots = Number(argOf('bots'));
  const duration = Number(argOf('duration'));
  const behavior = argOf('behavior') as BotBehavior | undefined;
  return {
    ...scenario,
    ...(Number.isFinite(bots) && bots > 0 && { bots }),
    ...(Number.isFinite(duration) &&
      duration > 0 && {
        durationSeconds: duration,
      }),
    ...(behavior && { behavior }),
  };
}

/** Players per map, straight from the server, for reading a spread back. */
async function scrapeDistribution(
  cookie: string | null,
): Promise<Array<{ mapId: string; players: number }>> {
  if (!cookie) return [];
  try {
    const res = await fetch(`${baseUrl}/metrics`, {
      headers: { Cookie: cookie },
    });
    if (!res.ok) return [];
    const out: Array<{ mapId: string; players: number }> = [];
    for (const line of (await res.text()).split('\n')) {
      const match =
        /^engine_players_by_map\{map="([^"]*)"\} (\d+(?:\.\d+)?)$/.exec(
          line.trim(),
        );
      if (match) out.push({ mapId: match[1]!, players: Number(match[2]) });
    }
    return out;
  } catch {
    return [];
  }
}

async function scrapeMetrics(
  cookie: string | null,
): Promise<ServerSnapshot | undefined> {
  if (!cookie) return undefined;
  try {
    const res = await fetch(`${baseUrl}/metrics`, {
      headers: { Cookie: cookie },
    });
    if (!res.ok) return undefined;
    return toServerSnapshot(parseMetrics(await res.text()));
  } catch {
    return undefined;
  }
}

/** Logs in as an admin so /metrics can be scraped; null when not configured. */
async function adminCookie(): Promise<string | null> {
  if (!adminUser || !adminPass) return null;
  try {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUser, password: adminPass }),
    });
    if (!res.ok) {
      console.warn(`  admin login failed (${res.status}); skipping /metrics`);
      return null;
    }
    const cookies = res.headers.getSetCookie?.() ?? [];
    return cookies.map((c) => c.split(';')[0]).join('; ') || null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Places the bots around the world when the scenario asks for a spread,
 * and says so out loud whenever it cannot.
 */
async function spreadIfAsked(
  usernames: string[],
  cookie: string | null,
  scenario: Scenario,
): Promise<void> {
  const wantsSpread =
    hasFlag('spread') || (scenario.spread && !hasFlag('no-spread'));
  const wantsGather = hasFlag('gather');
  if (!wantsSpread && !wantsGather) {
    await warnIfAlreadyScattered(usernames.length, cookie);
    return;
  }

  if (!cookie) {
    console.warn(
      `  ${wantsGather ? 'gather' : 'spread'} SKIPPED: placing bots needs ` +
        '--admin-user/--admin-pass.\n  This run stands wherever the accounts ' +
        'were left, which is not necessarily what the label says.',
    );
    return;
  }

  try {
    const maps = await fetchMaps(baseUrl, cookie);

    if (wantsGather) {
      const placements = planGathering(maps, usernames, startMapId(maps));
      const result = await applyPlacements(baseUrl, cookie, placements);
      console.log(
        `  gather: placed ${result.placed}/${placements.length} on map ` +
          `${placements[0]?.mapId ?? '?'}, one viewport, all in view of each other`,
      );
      for (const error of result.errors) console.warn(`    ${error}`);
      return;
    }

    const assessment = assessWorld(maps, usernames.length);
    for (const warning of assessment.warnings) {
      console.warn(`  spread WARNING: ${warning}`);
    }

    const placements = planPlacements(maps, usernames);
    const result = await applyPlacements(baseUrl, cookie, placements);
    console.log(
      `  spread: placed ${result.placed}/${placements.length} across ` +
        `${maps.length} map(s), ${assessment.viewportsAvailable} viewport(s) of room`,
    );
    for (const error of result.errors) console.warn(`    ${error}`);
  } catch (err) {
    console.warn(
      `  placement failed: ${String(err)}; continuing wherever they stand`,
    );
  }
}

/** The map the bots log in on, which is where a crowd belongs. */
function startMapId(maps: Array<{ id: string }>): string {
  return argOf('gather-map') ?? maps[0]?.id ?? '1';
}

/**
 * Warns when bots already stand spread out. Accounts log in where the last
 * run left them, so a crowd run after a spread run is not a crowd.
 */
async function warnIfAlreadyScattered(
  bots: number,
  cookie: string | null,
): Promise<void> {
  const distribution = await scrapeDistribution(cookie);
  if (distribution.length === 0) return;
  const total = distribution.reduce((sum, entry) => sum + entry.players, 0);
  const busiest = Math.max(...distribution.map((entry) => entry.players));
  if (total > 0 && busiest / total < 0.8) {
    console.warn(
      `  WARNING: the population starts spread (busiest map holds ${busiest} ` +
        `of ${total}), because the accounts kept the positions an earlier run ` +
        'gave them. Pass --gather for a crowd run.',
    );
  } else if (bots > 0 && busiest < bots * 0.8) {
    console.warn(
      `  note: ${busiest} of ${bots} bots are on the busiest map at the start.`,
    );
  }
}

/**
 * Scrapes /metrics on an interval for the length of the run, since telling
 * a leak from a warm cache needs a slope.
 */
function startSampler(
  cookie: string | null,
  everySeconds: number,
): { samples: SoakSample[]; stop: () => void } {
  const samples: SoakSample[] = [];
  const startedAt = Date.now();

  const timer = setInterval(() => {
    void (async () => {
      const server = await scrapeMetrics(cookie);
      if (server) samples.push({ atMs: Date.now() - startedAt, server });
    })();
  }, everySeconds * 1000);
  timer.unref?.();

  return { samples, stop: () => clearInterval(timer) };
}

async function run(): Promise<void> {
  const scenario = resolveScenario();
  const random = mulberry32(1234);

  console.log(`\n${scenario.id}: ${scenario.description}`);
  console.log(`  watching: ${scenario.watch}`);
  console.log(`  target: ${baseUrl}\n`);

  const cookie = await adminCookie();
  const before = await scrapeMetrics(cookie);

  const bots = Array.from(
    { length: scenario.bots },
    (_, i) =>
      new LoadBot({
        baseUrl,
        username: `${prefix}_${i}`,
        password,
        behavior: scenario.behavior,
        // About a player holding a direction and changing their mind; faster
        // would only queue input the server drops.
        actionIntervalMs: 250 + Math.floor(random() * 250),
      }),
  );

  // Connecting is itself measured, so it runs in bounded waves rather than
  // saturating the harness's own event loop.
  const connected: LoadBot[] = [];
  const concurrency = Number(argOf('connect-concurrency')) || 25;
  const connectStarted = Date.now();

  for (let i = 0; i < bots.length; i += concurrency) {
    const wave = bots.slice(i, i + concurrency);
    const results = await Promise.allSettled(wave.map((b) => b.connect()));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') connected.push(wave[idx]!);
      else if (connected.length === 0 && i === 0) {
        console.error(`  first connection failed: ${r.reason}`);
      }
    });
    process.stdout.write(
      `\r  connected ${connected.length}/${bots.length}`.padEnd(40),
    );
  }

  const connectSeconds = (Date.now() - connectStarted) / 1000;
  console.log(`\n  connect phase took ${connectSeconds.toFixed(1)}s\n`);

  if (connected.length === 0) {
    console.error('  no bots connected; nothing to measure');
    process.exit(1);
  }

  // Spread before anyone moves, so the lattice is the starting state.
  await spreadIfAsked(
    connected.map((b) => b.username),
    cookie,
    scenario,
  );

  for (const bot of connected) bot.startActing(random);

  // The first seconds are map metadata and chunk downloads, not steady state.
  await sleep(3000);
  for (const bot of connected) {
    bot.sample.bytesReceived = 0;
    bot.sample.messagesReceived = 0;
    bot.sample.worldUpdates = 0;
  }

  const sampleEvery = Number(argOf('sample-every'));
  const sampler =
    Number.isFinite(sampleEvery) && sampleEvery > 0
      ? startSampler(cookie, sampleEvery)
      : undefined;

  const measureStarted = Date.now();
  if (scenario.behavior === 'reconnect') {
    await runReconnectChurn(connected, scenario, random);
  } else {
    await sleep(scenario.durationSeconds * 1000);
  }
  const measuredSeconds = (Date.now() - measureStarted) / 1000;

  sampler?.stop();
  const after = await scrapeMetrics(cookie);
  // Read where players ended up before disconnecting: only that belongs next
  // to a number, not what placement asked for.
  const distribution = await scrapeDistribution(cookie);
  await Promise.all(connected.map((b) => b.close()));

  const report = buildReport({
    scenario: `${scenario.id} (${scenario.description})`,
    requestedBots: scenario.bots,
    samples: connected.map((b) => b.sample),
    durationSeconds: measuredSeconds,
    before,
    after,
  });

  console.log(jsonOut ? JSON.stringify(report, null, 2) : formatReport(report));
  if (!jsonOut && distribution.length > 0) {
    console.log(`  distribution: ${summarizeDistribution(distribution)}`);
  }

  if (sampler && sampler.samples.length) {
    // `before` has no bots connected, so memory per player is a difference.
    console.log(formatSoak(sampler.samples, before));
    const csvPath = argOf('csv');
    if (csvPath) {
      writeFileSync(csvPath, toSoakCsv(sampler.samples));
      console.log(`  series written to ${csvPath}\n`);
    }
  }

  if (!after) {
    console.log(
      '  (server-side tick percentiles need --admin-user/--admin-pass)\n',
    );
  }
  process.exit(0);
}

/** Drops and re-establishes a slice of the bots every few seconds. */
async function runReconnectChurn(
  bots: LoadBot[],
  scenario: Scenario,
  random: () => number,
): Promise<void> {
  const cycles = Math.max(1, Math.floor(scenario.durationSeconds / 10));
  for (let cycle = 0; cycle < cycles; cycle++) {
    const victims = bots.filter(() => random() < 0.25);
    for (const bot of victims) bot.drop();
    await sleep(2000);
    await Promise.allSettled(
      victims.map(async (bot) => {
        await bot.connect();
        bot.startActing(random);
      }),
    );
    await sleep(8000);
  }
}

if (hasFlag('list')) {
  console.log('\nScenarios:\n');
  for (const s of SCENARIOS) {
    console.log(
      `  ${s.id.padEnd(8)} ${String(s.bots).padStart(5)} bots  ${s.durationSeconds}s  ${s.description}`,
    );
  }
  console.log('');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
