import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerEntityBehavior,
  dispatchEntityScript,
  getEntityBehavior,
  knownBehaviorIds,
  clearEntityBehaviors,
} from './entityScripts.js';
import { getScriptErrors, clearScriptErrors } from './scriptErrors.js';

beforeEach(() => {
  clearEntityBehaviors();
  clearScriptErrors();
});

const anyCtx = {} as never;

describe('registerEntityBehavior', () => {
  it('makes the behavior reachable by id', () => {
    const behavior = { onEnter: vi.fn() };
    registerEntityBehavior('trap', behavior, 'traps.js');

    expect(getEntityBehavior('trap')).toBe(behavior);
    expect(knownBehaviorIds()).toEqual(new Set(['trap']));
  });

  it('returns a detach that removes it', () => {
    const detach = registerEntityBehavior('trap', {}, 'traps.js');
    detach();

    expect(getEntityBehavior('trap')).toBeUndefined();
  });

  // Reloading a file re-registers its own ids; that is the normal path and
  // must not warn.
  it('lets a script replace its own registration silently', () => {
    const first = { onEnter: vi.fn() };
    const second = { onEnter: vi.fn() };
    registerEntityBehavior('trap', first, 'traps.js');
    registerEntityBehavior('trap', second, 'traps.js');

    expect(getEntityBehavior('trap')).toBe(second);
  });

  it('lets the last of two scripts win the same id', () => {
    registerEntityBehavior('trap', { onEnter: vi.fn() }, 'a.js');
    const second = { onEnter: vi.fn() };
    registerEntityBehavior('trap', second, 'b.js');

    expect(getEntityBehavior('trap')).toBe(second);
  });

  // Otherwise a reload of the loser would delete the winner's entry and the
  // content would silently stop working.
  it('does not let a losing script detach the winner', () => {
    const detachA = registerEntityBehavior('trap', {}, 'a.js');
    const winner = { onEnter: vi.fn() };
    registerEntityBehavior('trap', winner, 'b.js');

    detachA();

    expect(getEntityBehavior('trap')).toBe(winner);
  });
});

describe('dispatchEntityScript', () => {
  it('runs the handler for the event and reports that it ran', () => {
    const onEnter = vi.fn();
    registerEntityBehavior('trap', { onEnter }, 'traps.js');

    const ran = dispatchEntityScript('trap', 'onEnter', anyCtx);

    expect(ran).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('passes the context straight through', () => {
    const onInteract = vi.fn();
    registerEntityBehavior('sage', { onInteract }, 'npcs.js');
    const ctx = { player: { name: 'Alice' }, npc: { id: 'n1' } };

    dispatchEntityScript('sage', 'onInteract', ctx as never);

    expect(onInteract).toHaveBeenCalledWith(ctx);
  });

  it('does nothing for an entity with no scriptId', () => {
    expect(dispatchEntityScript(undefined, 'onEnter', anyCtx)).toBe(false);
  });

  it('does nothing when the behavior has no handler for that event', () => {
    registerEntityBehavior('trap', { onEnter: vi.fn() }, 'traps.js');

    expect(dispatchEntityScript('trap', 'onDeath', anyCtx)).toBe(false);
  });

  it('does nothing for an id nobody registered', () => {
    expect(dispatchEntityScript('ghost', 'onEnter', anyCtx)).toBe(false);
  });

  it('keeps the right handler when several behaviors exist', () => {
    const trap = vi.fn();
    const heal = vi.fn();
    registerEntityBehavior('trap', { onEnter: trap }, 'a.js');
    registerEntityBehavior('heal', { onEnter: heal }, 'b.js');

    dispatchEntityScript('heal', 'onEnter', anyCtx);

    expect(heal).toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
  });

  describe('a handler that throws', () => {
    it('does not propagate into the caller', () => {
      registerEntityBehavior(
        'trap',
        {
          onEnter: () => {
            throw new Error('boom');
          },
        },
        'traps.js',
      );

      expect(() =>
        dispatchEntityScript('trap', 'onEnter', anyCtx),
      ).not.toThrow();
    });

    it('is recorded against the script that registered it', () => {
      registerEntityBehavior(
        'trap',
        {
          onEnter: () => {
            throw new Error('boom');
          },
        },
        'traps.js',
      );

      dispatchEntityScript('trap', 'onEnter', anyCtx);

      const [error] = getScriptErrors('traps.js');
      expect(error).toMatchObject({
        script: 'traps.js',
        source: 'behavior',
        context: 'trap.onEnter',
      });
    });

    it('still counts as having run, so callers do not treat it as absent', () => {
      registerEntityBehavior(
        'trap',
        {
          onEnter: () => {
            throw new Error('boom');
          },
        },
        'traps.js',
      );

      expect(dispatchEntityScript('trap', 'onEnter', anyCtx)).toBe(true);
    });
  });
});

describe('knownBehaviorIds', () => {
  it('lists every registered id, for validating content that names them', () => {
    registerEntityBehavior('a', {}, 'x.js');
    registerEntityBehavior('b', {}, 'y.js');

    expect(knownBehaviorIds()).toEqual(new Set(['a', 'b']));
  });

  it('is a copy, so a caller cannot corrupt the registry', () => {
    registerEntityBehavior('a', {}, 'x.js');
    knownBehaviorIds().add('fake');

    expect(knownBehaviorIds()).toEqual(new Set(['a']));
  });
});
