import { describe, it, expect } from 'vitest';
import {
  describeAction,
  formatTime,
  normalize,
  renderTimeline,
  resolveAt,
  selectEvents,
} from './replay.js';
import type { ReplayEvent } from '../src/server/sim/replayRecorder.js';
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
