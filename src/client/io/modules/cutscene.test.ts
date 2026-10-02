import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { loadClientModule, recordingContext } from '../../../test/clientModule';

// The shipped modules/cutscene/client.js, loaded the way the browser loads it.

let now = 0;
const advanceTime = (ms: number) => {
  now += ms;
};

beforeEach(() => {
  now = 10_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function load() {
  const mod = loadClientModule('cutscene');
  const play = (payload: unknown) => mod.handlers.get('cutscene')!(payload);
  const draw = (cam = { x: 0, y: 0 }) => {
    const rec = recordingContext();
    mod.overlays.forEach((o) => o.fn(rec.ctx, cam));
    return rec;
  };
  const text = (rec: ReturnType<typeof recordingContext>) =>
    rec.of('fillText').map((c) => c.args[0]);
  return { mod, play, draw, text };
}

const press = (key: string) => {
  const e = new KeyboardEvent('keydown', { key, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

describe('cutscene overlay', () => {
  it('draws on the hud layer, above the tint and the darkness', () => {
    const { mod } = load();
    expect(mod.overlays).toHaveLength(1);
    expect(mod.overlays[0].order).toBe(100);
  });

  it('draws nothing until a script plays one', () => {
    const { draw } = load();
    expect(draw().calls).toEqual([]);
  });

  it('slides the bars in, in screen space', () => {
    const { play, draw } = load();
    play({ lines: ['a'] });

    const opening = draw({ x: 640, y: 480 });
    expect(opening.of('translate')[0].args).toEqual([640, 480]);
    const firstBar = opening.of('fillRect')[0].args as number[];
    expect(firstBar[3]).toBe(0); // nothing yet, at the very first frame

    advanceTime(320);
    const open = draw();
    expect((open.of('fillRect')[0].args as number[])[3]).toBeCloseTo(107.5, 0);
  });

  it('shows the speaker and the line, and the hint when it waits on input', () => {
    const { play, draw, text } = load();
    play({ speaker: 'Gatekeeper', lines: ['The gate groans open.'] });

    expect(text(draw())).toEqual([
      'Gatekeeper',
      'The gate groans open.',
      'click or Enter',
    ]);
  });

  it('wraps a long line instead of clipping it', () => {
    const { play, draw, text } = load();
    play({ lines: ['word '.repeat(40).trim()] });

    // one measured row per wrap, plus the hint
    expect(text(draw()).length).toBeGreaterThan(2);
  });

  it('advances on Enter and ends after the last line', () => {
    const { play, draw, text, mod } = load();
    play({ lines: ['one', 'two'] });

    expect(text(draw())).toContain('one');
    press('Enter');
    expect(text(draw())).toContain('two');
    press('Enter');

    expect(draw().calls).toEqual([]);
    expect(mod.engine.sendServerEvent).toHaveBeenCalledWith('cutscene:done');
  });

  it('ends on Escape without walking the rest of the lines', () => {
    const { play, draw } = load();
    play({ lines: ['one', 'two', 'three'] });

    press('Escape');

    expect(draw().calls).toEqual([]);
  });

  it('holds the keyboard while it plays, and lets it go after', () => {
    const { play } = load();
    play({ lines: ['one', 'two'] });

    expect(press('ArrowRight').defaultPrevented).toBe(true);

    press('Escape');
    expect(press('ArrowRight').defaultPrevented).toBe(false);
  });

  it('advances by itself when the script gave it a duration', () => {
    const { play, draw, text } = load();
    play({ lines: ['one', 'two'], auto: 1000 });

    expect(text(draw())).toEqual(['one']); // no hint: nothing to click

    advanceTime(1000);
    expect(text(draw())).toEqual(['two']);

    advanceTime(1000);
    expect(draw().calls).toEqual([]);
  });

  it('is ended by a script sending no lines, which is what a finally does', () => {
    const { play, draw, mod } = load();
    play({ lines: ['one'] });

    play(null);

    expect(draw().calls).toEqual([]);
    expect(mod.engine.sendServerEvent).toHaveBeenCalledWith('cutscene:done');
  });
});
