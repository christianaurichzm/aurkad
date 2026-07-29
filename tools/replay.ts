import { readFileSync } from 'fs';
import type {
  ReplayFile,
  ReplayEvent,
} from '../src/server/sim/replayRecorder.js';

const TICK_RATE = 20;
const TIMELINE_TICKS_PER_COL = 10;
const TIMELINE_MAX_COLS = 150;

const KEY_GLYPH: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Shift: 'R',
  x: '×',
  z: 'z',
  e: 'e',
  f: 'f',
  c: 'c',
  o: 'o',
  v: 'v',
  i: 'i',
  Control: 'C',
};

// Higher index = higher display priority
const KEY_PRIORITY: Record<string, number> = {
  ArrowUp: 10,
  ArrowDown: 10,
  ArrowLeft: 10,
  ArrowRight: 10,
  x: 8,
  z: 6,
  Shift: 4,
};
const keyPriority = (k: string) => KEY_PRIORITY[k] ?? 2;

function buildHeldState(
  events: ReplayEvent[],
  minTick: number,
  maxTick: number,
): Map<string, Set<string>> {
  // Map<username, Set<key>>: held at the START of each tick window
  const held = new Map<string, Set<string>>();
  // We build a tick->events index
  const byTick = new Map<number, ReplayEvent[]>();
  for (const e of events) {
    const t = e.tick;
    if (!byTick.has(t)) byTick.set(t, []);
    byTick.get(t)!.push(e);
  }

  // Per player, per column: what was held
  const players = [...new Set(events.map((e) => e.username))];
  for (const p of players) held.set(p, new Set());

  // Simulate held keys tick by tick, sampling at column boundaries
  const cols = Math.min(
    TIMELINE_MAX_COLS,
    Math.ceil((maxTick - minTick + 1) / TIMELINE_TICKS_PER_COL),
  );
  const result = new Map<string, string[]>(); // player -> glyph per col
  for (const p of players) result.set(p, Array(cols).fill(' '));

  const heldNow = new Map<string, Set<string>>();
  for (const p of players) heldNow.set(p, new Set());

  for (
    let colIdx = 0;
    colIdx < cols;
    colIdx++
  ) {
    const startTick = minTick + colIdx * TIMELINE_TICKS_PER_COL;
    const endTick = startTick + TIMELINE_TICKS_PER_COL - 1;

    for (let t = startTick; t <= endTick; t++) {
      const evs = byTick.get(t);
      if (!evs) continue;
      for (const e of evs) {
        const h = heldNow.get(e.username);
        if (!h) continue;
        if (e.type === 'press') h.add(e.key);
        else h.delete(e.key);
      }
    }

    // Pick best glyph for this column
    for (const p of players) {
      const h = heldNow.get(p)!;
      if (h.size === 0) continue;
      const best = [...h].sort((a, b) => keyPriority(b) - keyPriority(a))[0]!;
      result.get(p)![colIdx] = KEY_GLYPH[best] ?? best[0] ?? '?';
    }
  }

  // Merge into held map (reused for the return as a player->glyphs string)
  held.clear();
  for (const [p, glyphs] of result) {
    (held as unknown as Map<string, string[]>).set(p, glyphs);
  }
  return held as unknown as Map<string, Set<string>>;
}

function printTimeline(
  events: ReplayEvent[],
  minTick: number,
  maxTick: number,
) {
  const players = [...new Set(events.map((e) => e.username))].sort();
  const cols = Math.min(
    TIMELINE_MAX_COLS,
    Math.ceil((maxTick - minTick + 1) / TIMELINE_TICKS_PER_COL),
  );

  // Build held state per column (we inline the logic here properly)
  const byTick = new Map<number, ReplayEvent[]>();
  for (const e of events) {
    if (!byTick.has(e.tick)) byTick.set(e.tick, []);
    byTick.get(e.tick)!.push(e);
  }

  const heldNow = new Map<string, Set<string>>();
  const glyphs = new Map<string, string[]>();
  for (const p of players) {
    heldNow.set(p, new Set());
    glyphs.set(p, Array(cols).fill(' '));
  }

  for (let colIdx = 0; colIdx < cols; colIdx++) {
    const startTick = minTick + colIdx * TIMELINE_TICKS_PER_COL;
    const endTick = startTick + TIMELINE_TICKS_PER_COL - 1;

    for (let t = startTick; t <= endTick; t++) {
      for (const e of byTick.get(t) ?? []) {
        const h = heldNow.get(e.username);
        if (!h) continue;
        if (e.type === 'press') h.add(e.key);
        else h.delete(e.key);
      }
    }

    for (const p of players) {
      const h = heldNow.get(p)!;
      if (h.size === 0) continue;
      const best = [...h].sort((a, b) => keyPriority(b) - keyPriority(a))[0]!;
      glyphs.get(p)![colIdx] = KEY_GLYPH[best] ?? best[0] ?? '?';
    }
  }

  const labelW = Math.max(...players.map((p) => p.length), 6);
  const ticksShown = cols * TIMELINE_TICKS_PER_COL;
  const secsShown = (ticksShown / TICK_RATE).toFixed(0);

  console.log('\nTimeline  (1 char = 10 ticks / 0.5s):');
  const ruler =
    ' '.repeat(labelW + 2) +
    `[0${' '.repeat(Math.max(0, Math.floor(cols / 2) - 3))}${secsShown}s]`;
  console.log(ruler);

  for (const p of players) {
    const label = p.padEnd(labelW);
    console.log(`${label}  ${glyphs.get(p)!.join('')}`);
  }

  console.log(
    `\nGlyphs: ↑↓←→=move  R=run  ×=attack  z=interact  e=equip  space=idle`,
  );
}

async function runSimulation(data: ReplayFile) {
  console.log('\nRunning simulation…');

  const { createFixture } = await import(
    '../src/server/sim/simFixture.js'
  );
  const { getTick } = await import('../src/server/sim/clock.js');

  const players = [...new Set(data.events.map((e) => e.username))];
  const fixture = createFixture(data.seed);

  const playerMap = new Map<string, ReturnType<typeof fixture.addPlayer>>();
  for (const name of players) {
    const p = fixture.addPlayer({ name });
    playerMap.set(name, p);
  }

  const byTick = new Map<number, ReplayEvent[]>();
  for (const e of data.events) {
    if (!byTick.has(e.tick)) byTick.set(e.tick, []);
    byTick.get(e.tick)!.push(e);
  }

  const maxTick =
    data.events.length > 0
      ? data.events[data.events.length - 1]!.tick
      : 0;

  const lastPos = new Map<string, string>();
  const lastAction = new Map<string, string>();

  for (let t = 0; t <= maxTick; t++) {
    const evs = byTick.get(t) ?? [];
    for (const e of evs) {
      if (e.type === 'press') fixture.press(e.username, e.key as never);
      else fixture.release(e.username, e.key as never);
    }
    fixture.step(1);

    const tick = getTick();
    for (const [name, p] of playerMap) {
      const posStr = `(${Math.round(p.position.x)},${Math.round(p.position.y)})`;
      const actStr = `${p.action}/${p.direction}`;
      if (posStr !== lastPos.get(name) || actStr !== lastAction.get(name)) {
        const hp = `hp:${p.health}/${p.maxHealth}`;
        console.log(`  t=${String(tick).padStart(4)} ${name.padEnd(12)} pos=${posStr.padEnd(12)} ${actStr.padEnd(16)} ${hp}`);
        lastPos.set(name, posStr);
        lastAction.set(name, actStr);
      }
    }
  }

  console.log('\nFinal state:');
  for (const [name, p] of playerMap) {
    console.log(
      `  ${name.padEnd(12)} pos=(${Math.round(p.position.x)},${Math.round(p.position.y)}) hp:${p.health}/${p.maxHealth}`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const runSim = args.includes('--run');

  if (!file) {
    console.error(
      'Usage: npm run replay -- <file.json> [--run]\n' +
        '  --run   execute the simulation headlessly and print state changes',
    );
    process.exit(1);
  }

  const data: ReplayFile = JSON.parse(readFileSync(file, 'utf8'));

  const byPlayer = new Map<string, number>();
  for (const e of data.events) {
    byPlayer.set(e.username, (byPlayer.get(e.username) ?? 0) + 1);
  }

  const minTick = data.events.length > 0 ? data.events[0]!.tick : 0;
  const maxTick =
    data.events.length > 0
      ? data.events[data.events.length - 1]!.tick
      : 0;
  const tickSpan = maxTick - minTick + 1;
  const durationSec = (tickSpan / TICK_RATE).toFixed(1);

  console.log(`\nReplay  ${file}`);
  console.log(`  version  : ${data.version}`);
  console.log(`  seed     : ${data.seed}`);
  console.log(`  started  : ${data.startedAt}`);
  console.log(
    `  duration : ${tickSpan} ticks (~${durationSec}s @ ${TICK_RATE}Hz)`,
  );
  console.log(`  events   : ${data.events.length}`);
  console.log(
    `  players  : ${
      [...byPlayer.entries()]
        .map(([k, v]) => `${k} (${v})`)
        .join(', ') || 'none'
    }`,
  );

  if (data.events.length > 0) {
    printTimeline(data.events, minTick, maxTick);
  }

  if (runSim) {
    await runSimulation(data);
  } else if (data.events.length > 0) {
    console.log('\nTip: add --run to execute the simulation headlessly.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
