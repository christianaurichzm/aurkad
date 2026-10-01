import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { ClientKeyboardAction } from '../src/server/engine/actions.js';
import type {
  RecordedAction,
  ReplayEvent,
  ReplayFile,
} from '../src/server/sim/replayRecorder.js';
import type { Key } from '../src/shared/types.js';

const TICK_RATE = 20;
const MS_PER_TICK = 1000 / TICK_RATE;
const TIMELINE_TICKS_PER_COL = 10;
const TIMELINE_MAX_COLS = 150;
const DEFAULT_LOG_LIMIT = 200;
const DEFAULT_WINDOW_SEC = 60;

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

/** v1 recorded held keys and nothing else; see `replayRecorder.ts`. */
interface LegacyEvent {
  tick: number;
  username: string;
  key: Key;
  type: 'press' | 'release';
}

interface LegacyFile {
  version: 1;
  seed: number;
  startedAt: string;
  events: LegacyEvent[];
}

/**
 * Reads either format as v2, so a file recorded in the v1 format still
 * opens. A v1 event carries no wall clock, and the offset from the first
 * recorded tick is the closest honest reconstruction: right about elapsed
 * time, and inventing nothing beyond the `startedAt` the file states.
 */
export function normalize(data: ReplayFile | LegacyFile): ReplayFile {
  if (data.version !== 1) return data;

  const base = Date.parse(data.startedAt) || 0;
  const firstTick = data.events.length > 0 ? data.events[0]!.tick : 0;

  return {
    version: 2,
    seed: data.seed,
    startedAt: data.startedAt,
    dropped: 0,
    events: data.events.map((event) => ({
      tick: event.tick,
      at: base + (event.tick - firstTick) * MS_PER_TICK,
      action: {
        type: 'keyboard',
        username: event.username,
        keyboardAction: { key: event.key, type: event.type },
      },
    })),
  };
}

type RecordedType = RecordedAction['type'];

const keyboardOf = (event: ReplayEvent): ClientKeyboardAction | undefined =>
  event.action.type === 'keyboard' ? event.action : undefined;

/**
 * A player leaving ends whatever they were holding: the server clears held
 * keys on disconnect, so a reader ignoring this would show, and re-run,
 * someone walking long after they closed the tab.
 */
const isLeave = (event: ReplayEvent): boolean =>
  event.action.type === 'session' && event.action.event === 'leave';

/** One action as a line an operator reads without knowing the wire format. */
export function describeAction(action: RecordedAction): string {
  switch (action.type) {
    case 'session':
      return action.event === 'join' ? 'connected' : 'disconnected';
    case 'keyboard':
      return `key ${action.keyboardAction.type === 'press' ? 'down' : 'up'} ${
        action.keyboardAction.key
      }`;
    case 'item': {
      const amount =
        action.quantity !== undefined && action.quantity > 1
          ? ` x${action.quantity}`
          : '';
      return `item ${action.action} #${action.item}${amount}`;
    }
    case 'chat':
      return `chat/${action.scope} ${JSON.stringify(action.message)}`;
    case 'language':
      return `language ${action.language}`;
    case 'moveTo':
      return `walk to (${action.col}, ${action.row})`;
    case 'custom': {
      const payload =
        action.payload === undefined
          ? ''
          : ` ${JSON.stringify(action.payload)}`;
      return `custom ${action.channel}${payload}`;
    }
  }
}

export interface Selection {
  player?: string;
  /** Inclusive wall-clock window, in epoch ms. */
  from?: number;
  to?: number;
  grep?: string;
}

/**
 * The window of interest: who, when, and what the line says. Not the type
 * filter: the timeline and the log narrow to the same window but show
 * different kinds of action, so dropping keyboard events here would empty
 * the timeline too.
 */
export function selectEvents(
  events: ReplayEvent[],
  selection: Selection,
): ReplayEvent[] {
  const grep = selection.grep?.toLowerCase();
  return events.filter((event) => {
    if (selection.player && event.action.username !== selection.player) {
      return false;
    }
    if (selection.from !== undefined && event.at < selection.from) return false;
    if (selection.to !== undefined && event.at > selection.to) return false;
    if (grep && !describeAction(event.action).toLowerCase().includes(grep)) {
      return false;
    }
    return true;
  });
}

export function formatTime(at: number): string {
  if (!at) return '--:--:--.---';
  const date = new Date(at);
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.toLocaleTimeString([], { hour12: false })}.${ms}`;
}

/**
 * The held-key picture, one character per 10 ticks. Keyboard actions are
 * the bulk of any recording and say little one at a time; "walked left
 * for two seconds" is the readable unit, and it only exists as a shape.
 */
export function renderTimeline(events: ReplayEvent[]): string[] {
  const keys = events.filter(keyboardOf);
  if (keys.length === 0) return [];

  const minTick = keys[0]!.tick;
  const maxTick = keys[keys.length - 1]!.tick;
  const players = [...new Set(keys.map((e) => e.action.username))].sort();
  const cols = Math.max(
    1,
    Math.min(
      TIMELINE_MAX_COLS,
      Math.ceil((maxTick - minTick + 1) / TIMELINE_TICKS_PER_COL),
    ),
  );

  const byTick = new Map<number, ReplayEvent[]>();
  for (const event of events) {
    if (!keyboardOf(event) && !isLeave(event)) continue;
    const bucket = byTick.get(event.tick);
    if (bucket) bucket.push(event);
    else byTick.set(event.tick, [event]);
  }

  const heldNow = new Map<string, Set<string>>();
  const glyphs = new Map<string, string[]>();
  for (const player of players) {
    heldNow.set(player, new Set());
    glyphs.set(player, Array<string>(cols).fill(' '));
  }

  for (let colIdx = 0; colIdx < cols; colIdx++) {
    const startTick = minTick + colIdx * TIMELINE_TICKS_PER_COL;
    const endTick = startTick + TIMELINE_TICKS_PER_COL - 1;

    for (let t = startTick; t <= endTick; t++) {
      for (const event of byTick.get(t) ?? []) {
        const held = heldNow.get(event.action.username);
        if (!held) continue;
        const action = keyboardOf(event);
        if (!action) {
          held.clear();
          continue;
        }
        if (action.keyboardAction.type === 'press') {
          held.add(action.keyboardAction.key);
        } else {
          held.delete(action.keyboardAction.key);
        }
      }
    }

    for (const player of players) {
      const held = heldNow.get(player)!;
      if (held.size === 0) continue;
      const best = [...held].sort(
        (a, b) => keyPriority(b) - keyPriority(a),
      )[0]!;
      glyphs.get(player)![colIdx] = KEY_GLYPH[best] ?? best[0] ?? '?';
    }
  }

  const labelW = Math.max(...players.map((p) => p.length), 6);
  const secsShown = ((cols * TIMELINE_TICKS_PER_COL) / TICK_RATE).toFixed(0);

  return [
    '',
    'Timeline  (1 char = 10 ticks / 0.5s):',
    ' '.repeat(labelW + 2) +
      `[0${' '.repeat(Math.max(0, Math.floor(cols / 2) - 3))}${secsShown}s]`,
    ...players.map((p) => `${p.padEnd(labelW)}  ${glyphs.get(p)!.join('')}`),
    '',
    'Glyphs: ↑↓←→=move  R=run  ×=attack  z=interact  e=equip  blank=idle',
  ];
}

export function printSummary(
  file: string,
  data: ReplayFile,
  shown: ReplayEvent[],
  fileVersion: number,
) {
  const byType = new Map<RecordedType, number>();
  const byPlayer = new Map<string, number>();
  for (const event of shown) {
    byType.set(event.action.type, (byType.get(event.action.type) ?? 0) + 1);
    const name = event.action.username;
    byPlayer.set(name, (byPlayer.get(name) ?? 0) + 1);
  }

  const first = shown[0];
  const last = shown[shown.length - 1];
  const tickSpan = first && last ? last.tick - first.tick + 1 : 0;

  console.log(`\nReplay  ${file}`);
  console.log(
    `  version  : ${fileVersion}${
      fileVersion === data.version ? '' : ` (read as ${data.version})`
    }`,
  );
  if (data.label) console.log(`  label    : ${data.label}`);
  console.log(`  seed     : ${data.seed}`);
  console.log(`  started  : ${data.startedAt}`);
  if (first && last) {
    console.log(
      `  window   : ${formatTime(first.at)} - ${formatTime(last.at)}`,
    );
  }
  console.log(
    `  duration : ${tickSpan} ticks (~${(tickSpan / TICK_RATE).toFixed(1)}s @ ${TICK_RATE}Hz)`,
  );
  console.log(
    `  actions  : ${shown.length}${
      shown.length === data.events.length
        ? ''
        : ` of ${data.events.length} (filtered)`
    }`,
  );
  if (byType.size > 0) {
    console.log(
      `  by type  : ${[...byType]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} (${count})`)
        .join(', ')}`,
    );
  }
  console.log(
    `  players  : ${
      [...byPlayer]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name} (${count})`)
        .join(', ') || 'none'
    }`,
  );
  if (data.dropped > 0) {
    // The ring keeps the recent minutes; whoever reads the file has to know
    // the recording is older than its first line.
    console.log(
      `  dropped  : ${data.dropped} older actions fell out of the buffer before this file was written`,
    );
  }
}

export function printLog(
  events: ReplayEvent[],
  types: Set<RecordedType>,
  limit: number,
) {
  const lines = events.filter((event) => types.has(event.action.type));
  if (lines.length === 0) {
    console.log(`\nNo ${[...types].join('/')} actions in this window.`);
    return;
  }

  const nameW = Math.min(
    16,
    Math.max(...lines.map((e) => e.action.username.length)),
  );
  // The tail is the interesting end when a log is truncated: a complaint is
  // filed after the thing happened, not before it.
  const shown = lines.slice(-limit);
  if (shown.length < lines.length) {
    console.log(`\nLog  (last ${shown.length} of ${lines.length}):`);
  } else {
    console.log(`\nLog  (${lines.length}):`);
  }
  for (const event of shown) {
    console.log(
      `  ${formatTime(event.at)}  t=${String(event.tick).padStart(6)}  ${event.action.username.padEnd(
        nameW,
      )}  ${describeAction(event.action)}`,
    );
  }
}

async function runSimulation(data: ReplayFile, events: ReplayEvent[]) {
  const keys = events.filter(keyboardOf);
  const leaves = events.filter(isLeave).length;
  const logOnly = events.length - keys.length - leaves;

  console.log('\nRunning simulation…');
  // The fixture builds a fresh world from the seed, and a recording started
  // mid-session does not carry the world it was recorded against. So this
  // reproduces the input, not the incident: use it to study movement and
  // combat, not to prove what a player's inventory held.
  console.log(
    `  ${keys.length} keyboard actions re-simulated from seed ${data.seed}` +
      (leaves > 0
        ? `, ${leaves} disconnect${leaves === 1 ? '' : 's'} applied`
        : '') +
      (logOnly > 0
        ? `; ${logOnly} other action${logOnly === 1 ? '' : 's'} log-only`
        : '') +
      '\n  (fresh world - state that predates the recording is not reproduced)',
  );
  if (keys.length === 0) return;

  const { createFixture } = await import('../src/server/sim/simFixture.js');
  const { getTick } = await import('../src/server/sim/clock.js');

  const players = [...new Set(keys.map((e) => e.action.username))];
  const fixture = createFixture(data.seed);

  const playerMap = new Map<string, ReturnType<typeof fixture.addPlayer>>();
  for (const name of players) {
    playerMap.set(name, fixture.addPlayer({ name }));
  }

  const byTick = new Map<number, ReplayEvent[]>();
  for (const event of events) {
    if (!keyboardOf(event) && !isLeave(event)) continue;
    const bucket = byTick.get(event.tick);
    if (bucket) bucket.push(event);
    else byTick.set(event.tick, [event]);
  }

  const minTick = keys[0]!.tick;
  const maxTick = keys[keys.length - 1]!.tick;
  const lastPos = new Map<string, string>();
  const lastAction = new Map<string, string>();
  const held = new Map<string, Set<Key>>();

  for (let t = minTick; t <= maxTick; t++) {
    for (const event of byTick.get(t) ?? []) {
      const name = event.action.username;
      const action = keyboardOf(event);
      const holding = held.get(name) ?? new Set<Key>();
      held.set(name, holding);
      if (!action) {
        // Disconnect: the real server drops the held keys, so the simulation
        // has to as well or it keeps walking a player who logged off.
        for (const key of holding) fixture.release(name, key);
        holding.clear();
        continue;
      }
      if (action.keyboardAction.type === 'press') {
        holding.add(action.keyboardAction.key);
        fixture.press(name, action.keyboardAction.key);
      } else {
        holding.delete(action.keyboardAction.key);
        fixture.release(name, action.keyboardAction.key);
      }
    }
    fixture.step(1);

    const tick = getTick();
    for (const [name, player] of playerMap) {
      const posStr = `(${Math.round(player.position.x)},${Math.round(player.position.y)})`;
      const actStr = `${player.action}/${player.direction}`;
      if (posStr !== lastPos.get(name) || actStr !== lastAction.get(name)) {
        console.log(
          `  t=${String(tick).padStart(4)} ${name.padEnd(12)} pos=${posStr.padEnd(12)} ${actStr.padEnd(
            16,
          )} hp:${player.health}/${player.maxHealth}`,
        );
        lastPos.set(name, posStr);
        lastAction.set(name, actStr);
      }
    }
  }

  console.log('\nFinal state:');
  for (const [name, player] of playerMap) {
    console.log(
      `  ${name.padEnd(12)} pos=(${Math.round(player.position.x)},${Math.round(
        player.position.y,
      )}) hp:${player.health}/${player.maxHealth}`,
    );
  }
}

const USAGE = `Usage: npm run replay -- <file.json> [options]
  --player=<name>   only this player's actions
  --type=<a,b>      log these kinds: keyboard, item, chat, custom, session
                    (default: everything but keyboard, which the timeline shows)
  --at=<HH:MM[:SS]> centre on a local time of the recording's day
  --window=<sec>    half-width of --at (default ${DEFAULT_WINDOW_SEC})
  --grep=<text>     only lines containing this text
  --limit=<n>       log lines to print (default ${DEFAULT_LOG_LIMIT})
  --run             re-simulate the keyboard actions headlessly`;

const flag = (args: string[], name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};

/**
 * `--at` is read against the recording's own local day: the operator types the
 * time from the complaint ("around eight"), not an epoch.
 */
export function resolveAt(startedAt: string, at: string): number | undefined {
  const parts = at.split(':').map(Number);
  const [hours, minutes, seconds = 0] = parts;
  if (
    parts.length < 2 ||
    parts.some(Number.isNaN) ||
    hours === undefined ||
    minutes === undefined
  ) {
    return undefined;
  }
  const day = new Date(Date.parse(startedAt) || Date.now());
  day.setHours(hours, minutes, seconds, 0);
  return day.getTime();
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));

  if (!file) {
    console.error(USAGE);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(file, 'utf8')) as ReplayFile | LegacyFile;
  const data = normalize(raw);

  const selection: Selection = {
    player: flag(args, 'player'),
    grep: flag(args, 'grep'),
  };
  const at = flag(args, 'at');
  if (at) {
    const centre = resolveAt(data.startedAt, at);
    if (centre === undefined) {
      console.error(`Cannot read --at=${at}; expected HH:MM or HH:MM:SS.`);
      process.exit(1);
    }
    const half = Number(flag(args, 'window') ?? DEFAULT_WINDOW_SEC) * 1000;
    selection.from = centre - half;
    selection.to = centre + half;
  }

  const events = selectEvents(data.events, selection);
  const types = new Set<RecordedType>(
    (flag(args, 'type')
      ?.split(',')
      .map((t) => t.trim()) as RecordedType[] | undefined) ?? [
      'session',
      'item',
      'chat',
      'custom',
    ],
  );
  const limit = Number(flag(args, 'limit') ?? DEFAULT_LOG_LIMIT);

  printSummary(file, data, events, raw.version);
  for (const line of renderTimeline(events)) console.log(line);
  printLog(events, types, limit);

  if (args.includes('--run')) {
    await runSimulation(data, events);
  } else if (events.length > 0) {
    console.log('\nTip: add --run to execute the simulation headlessly.');
  }
}

// Only as a CLI: the helpers above are imported by replay.test.ts.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
