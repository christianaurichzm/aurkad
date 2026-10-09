/**
 * The time budget on script handlers. A handler that returns slowly is
 * measured and eventually dropped; one that never returns cannot be caught
 * inside this process, so these tests cover the first kind only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearHandlerBudget,
  handlerCosts,
  isHandlerDisabled,
  runWithBudget,
} from './handlerBudget.js';
import { clearScriptErrors, getScriptErrors } from './scriptErrors.js';
import { config } from '../../config.js';

const OVER = config.scripting.handlerBudgetMs + 5;
const STRIKES = config.scripting.handlerBudgetStrikes;

/**
 * Spends time on the clock the budget reads, which the test drives: on a real
 * one, a machine busy with the rest of the suite adds milliseconds to a
 * handler that is meant to be fast, and the order of two costs flips.
 */
const slow = (ms: number) => () => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] });
  clearHandlerBudget();
  clearScriptErrors();
});

afterEach(() => vi.useRealTimers());

describe('runWithBudget', () => {
  it('runs a fast handler and says so', () => {
    const handler = vi.fn();

    expect(runWithBudget('game.js', 'on:tick', handler)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(isHandlerDisabled('game.js', 'on:tick')).toBe(false);
  });

  it('never disables a handler that stays inside the budget', () => {
    for (let i = 0; i < STRIKES * 3; i++) {
      runWithBudget('game.js', 'on:tick', () => {});
    }

    expect(isHandlerDisabled('game.js', 'on:tick')).toBe(false);
  });

  it('keeps running a slow handler until it has used up its strikes', () => {
    for (let i = 0; i < STRIKES - 1; i++) {
      expect(runWithBudget('slow.js', 'on:tick', slow(OVER))).toBe(true);
    }

    expect(isHandlerDisabled('slow.js', 'on:tick')).toBe(false);
  });

  it('stops running it after that', () => {
    for (let i = 0; i < STRIKES; i++) {
      runWithBudget('slow.js', 'on:tick', slow(OVER));
    }

    const handler = vi.fn();
    expect(runWithBudget('slow.js', 'on:tick', handler)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  // The person who can fix it is looking at the file, not at the server log.
  it('reports the disabling in the script editor, against the file', () => {
    for (let i = 0; i < STRIKES; i++) {
      runWithBudget('slow.js', 'on:tick', slow(OVER));
    }

    const [error] = getScriptErrors('slow.js');
    expect(error).toMatchObject({ script: 'slow.js', source: 'budget' });
    expect(error?.message).toContain('disabled');
  });

  // One slow handler is not a reason to switch off the rest of the file, let
  // alone another script's.
  it('disables one handler, not the script', () => {
    for (let i = 0; i < STRIKES; i++) {
      runWithBudget('slow.js', 'on:tick', slow(OVER));
    }

    expect(isHandlerDisabled('slow.js', 'on:tick')).toBe(true);
    expect(isHandlerDisabled('slow.js', 'on:playerJoin')).toBe(false);
    expect(isHandlerDisabled('other.js', 'on:tick')).toBe(false);
  });

  // Attribution lives at the call sites, and catching an error here as well
  // would swallow it.
  it('lets a throw through, after timing it', () => {
    expect(() =>
      runWithBudget('game.js', 'on:tick', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });
});

describe('clearHandlerBudget', () => {
  // A reload means the file on disk is new code, so it gets its budget back.
  it('gives a reloaded script another chance', () => {
    for (let i = 0; i < STRIKES; i++) {
      runWithBudget('slow.js', 'on:tick', slow(OVER));
    }
    expect(isHandlerDisabled('slow.js', 'on:tick')).toBe(true);

    clearHandlerBudget('slow.js');

    expect(isHandlerDisabled('slow.js', 'on:tick')).toBe(false);
    expect(runWithBudget('slow.js', 'on:tick', () => {})).toBe(true);
  });

  it('leaves other scripts alone', () => {
    for (let i = 0; i < STRIKES; i++) {
      runWithBudget('a.js', 'on:tick', slow(OVER));
      runWithBudget('b.js', 'on:tick', slow(OVER));
    }

    clearHandlerBudget('a.js');

    expect(isHandlerDisabled('a.js', 'on:tick')).toBe(false);
    expect(isHandlerDisabled('b.js', 'on:tick')).toBe(true);
  });
});

/**
 * The other half of the same measurement, and the half the strike counter is
 * blind to: cost that arrives a little at a time.
 */
describe('handlerCosts', () => {
  it('adds up runs that never come near the budget', () => {
    for (let i = 0; i < 5; i++) runWithBudget('game.js', 'on:tick', slow(2));

    const [entry] = handlerCosts();
    expect(entry).toMatchObject({
      script: 'game.js',
      handler: 'on:tick',
      calls: 5,
    });
    // Cheap enough to never strike, and still 10ms of the server.
    expect(isHandlerDisabled('game.js', 'on:tick')).toBe(false);
    expect(entry!.totalMs).toBeGreaterThanOrEqual(9);
  });

  it('keeps one entry per handler, worst first', () => {
    runWithBudget('game.js', 'on:tick', slow(4));
    runWithBudget('game.js', 'on:playerJoin', slow(1));
    runWithBudget('other.js', 'chest.onEnter', () => {});

    expect(handlerCosts().map((c) => `${c.script}|${c.handler}`)).toEqual([
      'game.js|on:tick',
      'game.js|on:playerJoin',
      'other.js|chest.onEnter',
    ]);
  });

  it('starts a reloaded script from zero', () => {
    runWithBudget('game.js', 'on:tick', slow(2));
    clearHandlerBudget('game.js');

    expect(handlerCosts()).toEqual([]);
  });
});

describe('share of wall clock', () => {
  /**
   * A fresh module with the window and threshold it needs, on a clock the
   * test drives. The clock is faked before the import, since the module
   * starts its first window from performance.now() on load. Handlers spend
   * time by advancing it, so a minute of server time takes no real minute.
   */
  async function withWindow(windowMs: number, warnPercent = 10) {
    vi.resetModules();
    process.env.SCRIPT_TIME_WINDOW_MS = String(windowMs);
    process.env.SCRIPT_TIME_SHARE_WARN_PERCENT = String(warnPercent);
    vi.useFakeTimers({ toFake: ['performance'] });
    return await import('./handlerBudget.js');
  }

  const idle = (ms: number) => vi.advanceTimersByTime(ms);

  /** The logger writes to stderr, so that is where a warning has to show up. */
  function captureLog() {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    return written;
  }

  afterEach(() => {
    delete process.env.SCRIPT_TIME_WINDOW_MS;
    delete process.env.SCRIPT_TIME_SHARE_WARN_PERCENT;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports nothing until a window has closed', async () => {
    const budget = await withWindow(60_000);

    budget.runWithBudget('game.js', 'on:tick', slow(2));

    // Read halfway, a window would say a script costs half what it does.
    expect(budget.scriptTimeShares()).toEqual([]);
  });

  it('charges a script for what all of its handlers spent', async () => {
    const budget = await withWindow(1_000);

    budget.runWithBudget('game.js', 'on:tick', slow(300));
    budget.runWithBudget('game.js', 'on:playerJoin', slow(200));
    idle(600);
    // Costs nothing itself; it is only what crosses the boundary.
    budget.runWithBudget('quiet.js', 'on:tick', () => {});

    const shares = budget.scriptTimeShares();
    expect(shares[0]?.script).toBe('game.js');
    // 500ms of the 1100 that passed, both handlers counted together.
    expect(shares[0]?.percent).toBeCloseTo(45.45, 1);
    expect(shares.find((s) => s.script === 'quiet.js')?.percent).toBe(0);
  });

  // The line this whole thing exists for. Every call is well inside the budget,
  // nothing ever strikes, and the script still owns half the server.
  it('names a script that costs a lot in cheap pieces, and its worst handler', async () => {
    const log = captureLog();
    const budget = await withWindow(1_000, 20);

    for (let i = 0; i < 100; i++) {
      budget.runWithBudget('greedy.js', 'on:tick', slow(5));
    }
    budget.runWithBudget('greedy.js', 'on:chatMessage', slow(20));
    idle(480);
    budget.runWithBudget('greedy.js', 'on:playerJoin', () => {});

    expect(budget.isHandlerDisabled('greedy.js', 'on:tick')).toBe(false);

    const logged = log.join('\n');
    expect(logged).toContain('large share of the server');
    expect(logged).toContain('greedy.js');
    expect(logged).toContain('"worstHandler":"on:tick"');
  });

  it('stays quiet for a script under the share', async () => {
    const log = captureLog();
    const budget = await withWindow(1_000, 90);

    budget.runWithBudget('polite.js', 'on:tick', slow(100));
    idle(950);
    budget.runWithBudget('polite.js', 'on:tick', () => {});

    expect(budget.scriptTimeShares()[0]?.script).toBe('polite.js');
    expect(log.join('\n')).not.toContain('large share');
  });
});
