import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  describeAction,
  formatTime,
  normalize,
  printLog,
  printSummary,
  renderTimeline,
  resolveAt,
  selectEvents,
} from './replay.js';
import type {
  ReplayEvent,
  ReplayFile,
} from '../src/server/sim/replayRecorder.js';
import { Key } from '../src/shared/types.js';

const STARTED = '2026-08-08T20:00:00.000Z';
const base = Date.parse(STARTED);

const key = (
  tick: number,
  username: string,
  type: 'press' | 'release',
  k: Key = Key.ArrowRight,
): ReplayEvent => ({
  tick,
  at: base + tick * 50,
  action: { type: 'keyboard', username, keyboardAction: { key: k, type } },
});

describe('normalize', () => {
  it('reads a v1 recording as keyboard actions', () => {
    const data = normalize({
      version: 1,
      seed: 7,
      startedAt: STARTED,
      events: [
        { tick: 100, username: 'Alice', key: Key.ArrowUp, type: 'press' },
        { tick: 140, username: 'Alice', key: Key.ArrowUp, type: 'release' },
      ],
    });

    expect(data.version).toBe(2);
    expect(data.seed).toBe(7);
    expect(data.dropped).toBe(0);
    expect(data.events[0]!.action).toEqual({
      type: 'keyboard',
      username: 'Alice',
      keyboardAction: { key: Key.ArrowUp, type: 'press' },
    });
    // v1 has no wall clock: elapsed time is measured from the first tick
    // recorded, not from tick zero of a server that was already up.
    expect(data.events[0]!.at).toBe(base);
    expect(data.events[1]!.at).toBe(base + 2000);
  });

  it('passes a v2 recording through untouched', () => {
    const v2 = {
      version: 2 as const,
      seed: 1,
      startedAt: STARTED,
      dropped: 3,
      events: [key(0, 'Alice', 'press')],
    };
    expect(normalize(v2)).toBe(v2);
  });
});

describe('describeAction', () => {
  it('renders every kind of action, not only movement', () => {
    expect(
      describeAction({
        type: 'keyboard',
        username: 'Alice',
        keyboardAction: { key: Key.x, type: 'press' },
      }),
    ).toBe('key down x');
    expect(
      describeAction({
        type: 'item',
        username: 'Alice',
        item: 7,
        action: 'drop',
        quantity: 2,
      }),
    ).toBe('item drop #7 x2');
    expect(
      describeAction({
        type: 'chat',
        username: 'Alice',
        scope: 'global',
        message: 'where did it go',
      }),
    ).toBe('chat/global "where did it go"');
    expect(
      describeAction({
        type: 'custom',
        username: 'Alice',
        channel: 'trade:offer',
        payload: { to: 'Bob' },
      }),
    ).toBe('custom trade:offer {"to":"Bob"}');
    expect(
      describeAction({
        type: 'session',
        username: 'Alice',
        event: 'leave',
      }),
    ).toBe('disconnected');
  });
});

describe('selectEvents', () => {
  const events: ReplayEvent[] = [
    key(0, 'Alice', 'press'),
    key(20, 'Bob', 'press'),
    {
      tick: 40,
      at: base + 2000,
      action: {
        type: 'chat',
        username: 'Alice',
        scope: 'map',
        message: 'my sword is gone',
      },
    },
  ];

  it('narrows to one player', () => {
    expect(selectEvents(events, { player: 'Bob' })).toHaveLength(1);
  });

  it('narrows to a wall-clock window', () => {
    const window = selectEvents(events, {
      from: base + 500,
      to: base + 1500,
    });
    expect(window.map((e) => e.action.username)).toEqual(['Bob']);
  });

  it('searches the rendered line, so chat text is findable', () => {
    const hits = selectEvents(events, { grep: 'sword' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.action.type).toBe('chat');
  });

  it('keeps everything when nothing is asked of it', () => {
    expect(selectEvents(events, {})).toEqual(events);
  });
});

describe('renderTimeline', () => {
  it('draws a held key as a run of glyphs and drops it on release', () => {
    const lines = renderTimeline([
      key(0, 'Alice', 'press'),
      key(25, 'Alice', 'release'),
    ]);

    const row = lines.find((l) => l.startsWith('Alice'))!;
    expect(row).toBeTruthy();
    expect(row.trimEnd()).toBe('Alice   →→');
  });

  it('ends a held key where the player disconnected', () => {
    // Without the leave, the glyph run would carry to the end of the file and
    // show someone walking long after they closed the tab.
    const lines = renderTimeline([
      key(0, 'Alice', 'press'),
      {
        tick: 12,
        at: base + 600,
        action: { type: 'session', username: 'Alice', event: 'leave' },
      },
      key(50, 'Bob', 'press'),
    ]);

    const row = lines.find((l) => l.startsWith('Alice'))!;
    expect(row.trimEnd()).toBe('Alice   →');
  });

  it('has nothing to draw without keyboard actions', () => {
    expect(
      renderTimeline([
        {
          tick: 1,
          at: base,
          action: {
            type: 'chat',
            username: 'Alice',
            scope: 'global',
            message: 'hi',
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe('resolveAt', () => {
  it('reads a complaint time against the day the recording started', () => {
    const at = resolveAt(STARTED, '20:03');
    const expected = new Date(base);
    expected.setHours(20, 3, 0, 0);
    expect(at).toBe(expected.getTime());
  });

  it('refuses what it cannot read instead of centring on garbage', () => {
    expect(resolveAt(STARTED, 'eight')).toBeUndefined();
    expect(resolveAt(STARTED, '20:xx')).toBeUndefined();
  });
});

describe('formatTime', () => {
  it('says it does not know rather than printing the epoch', () => {
    expect(formatTime(0)).toBe('--:--:--.---');
  });
});

// The report is what an incident actually reads, so it is asserted on the
// lines it prints rather than on a return value it does not have.
const captured = () => {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  return lines;
};

const file = (over: Partial<ReplayFile> = {}): ReplayFile => ({
  version: 2,
  seed: 7,
  startedAt: STARTED,
  dropped: 0,
  events: [],
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printSummary', () => {
  it('reports the window, the counts and who acted', () => {
    const events = [
      key(0, 'ana', 'press'),
      key(4, 'ana', 'release'),
      key(6, 'bo', 'press'),
    ];
    const lines = captured();

    printSummary('r.json', file({ events, label: 'incident' }), events, 2);

    const text = lines.join('\n');
    expect(text).toContain('label    : incident');
    expect(text).toContain('seed     : 7');
    expect(text).toContain('duration : 7 ticks');
    expect(text).toContain('actions  : 3');
    expect(text).toContain('keyboard (3)');
    expect(text).toContain('ana (2), bo (1)');
    expect(text).not.toContain('dropped');
  });

  it('says the file is older than its first line when the ring dropped', () => {
    const lines = captured();

    printSummary('r.json', file({ dropped: 12 }), [], 2);

    const text = lines.join('\n');
    expect(text).toContain('dropped  : 12 older actions');
    expect(text).toContain('players  : none');
    expect(text).toContain('duration : 0 ticks');
  });

  it('names the version it read when the file was written by an older one', () => {
    const lines = captured();

    printSummary('r.json', file(), [], 1);

    expect(lines.join('\n')).toContain('version  : 1 (read as 2)');
  });

  it('marks the action count as filtered when it is a subset', () => {
    const events = [key(0, 'ana', 'press'), key(1, 'bo', 'press')];
    const lines = captured();

    printSummary('r.json', file({ events }), [events[0]!], 2);

    expect(lines.join('\n')).toContain('actions  : 1 of 2 (filtered)');
  });
});

describe('printLog', () => {
  it('prints one line per action of the asked type', () => {
    const lines = captured();

    printLog([key(3, 'ana', 'press')], new Set(['keyboard'] as const), 200);

    expect(lines.join('\n')).toContain('Log  (1):');
    expect(lines.join('\n')).toContain('t=     3');
    expect(lines.join('\n')).toContain('ana');
  });

  it('keeps the tail, because a complaint is filed after the fact', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      key(i, `p${i}`, 'press'),
    );
    const lines = captured();

    printLog(events, new Set(['keyboard'] as const), 2);

    const text = lines.join('\n');
    expect(text).toContain('Log  (last 2 of 5):');
    expect(text).toContain('p4');
    expect(text).not.toContain('p0');
  });

  it('says the window is empty instead of printing an empty header', () => {
    const lines = captured();

    printLog([key(0, 'ana', 'press')], new Set(['chat'] as const), 200);

    expect(lines.join('\n')).toContain('No chat actions in this window.');
  });
});
