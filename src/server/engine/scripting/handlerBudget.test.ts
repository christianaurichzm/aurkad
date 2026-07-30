/**
 * The time budget on script handlers. A handler that returns slowly is
 * measured and eventually dropped; one that never returns cannot be caught
 * inside this process, so these tests cover the first kind only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearHandlerBudget,
  disabledHandlers,
  isHandlerDisabled,
  runWithBudget,
} from './handlerBudget.js';
import { clearScriptErrors, getScriptErrors } from './scriptErrors.js';
import { config } from '../../config.js';

const OVER = config.scripting.handlerBudgetMs + 5;
const STRIKES = config.scripting.handlerBudgetStrikes;

/** Burns wall-clock time, which is what the budget actually measures. */
const slow = (ms: number) => () => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* blocking, exactly like the handler this catches */
  }
};

beforeEach(() => {
  clearHandlerBudget();
  clearScriptErrors();
});

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

  it('lists what is switched off', () => {
    for (let i = 0; i < STRIKES; i++) {
      runWithBudget('slow.js', 'chest.onEnter', slow(OVER));
    }

    expect(disabledHandlers()).toEqual([
      { script: 'slow.js', handler: 'chest.onEnter' },
    ]);
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
