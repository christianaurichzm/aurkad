import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerEntityBehavior,
  dispatchEntityScript,
  getEntityBehavior,
  registeredBehaviorParams,
  describeBehaviors,
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
    expect([...registeredBehaviorParams().keys()]).toEqual(['trap']);
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

  it('passes the context through, plus the resolved params', () => {
    const onInteract = vi.fn();
    registerEntityBehavior('sage', { onInteract }, 'npcs.js');
    const ctx = { player: { name: 'Alice' }, npc: { id: 'n1' } };

    dispatchEntityScript('sage', 'onInteract', ctx as never);

    expect(onInteract).toHaveBeenCalledWith({ ...ctx, params: {} });
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

// One behaviour, many configured instances: the values come from whichever
// npc/item/tile invoked it, so what a handler must never see is a value the
// declaration does not describe.
describe('declared params', () => {
  it('hands the content values to the handler, coerced to the declared type', () => {
    const onEnter = vi.fn();
    registerEntityBehavior(
      'chest',
      { params: { itemId: { type: 'item' } }, onEnter },
      'chest.js',
    );

    dispatchEntityScript('chest', 'onEnter', anyCtx, { itemId: '7' });

    expect(onEnter.mock.calls[0]?.[0]).toMatchObject({ params: { itemId: 7 } });
  });

  it('gives two pieces of content their own values from one behavior', () => {
    const onEnter = vi.fn();
    registerEntityBehavior(
      'chest',
      { params: { itemId: { type: 'item' } }, onEnter },
      'chest.js',
    );

    dispatchEntityScript('chest', 'onEnter', anyCtx, { itemId: 1 });
    dispatchEntityScript('chest', 'onEnter', anyCtx, { itemId: 2 });

    expect(onEnter.mock.calls.map((c) => c[0].params.itemId)).toEqual([1, 2]);
  });

  it('applies the declared default when content stored nothing', () => {
    const onEnter = vi.fn();
    registerEntityBehavior(
      'chest',
      { params: { quantity: { type: 'number', default: 3 } }, onEnter },
      'chest.js',
    );

    dispatchEntityScript('chest', 'onEnter', anyCtx, undefined);

    expect(onEnter.mock.calls[0]?.[0].params).toEqual({ quantity: 3 });
  });

  it('drops a stored key the behavior no longer declares', () => {
    const onEnter = vi.fn();
    registerEntityBehavior(
      'chest',
      { params: { itemId: { type: 'item' } }, onEnter },
      'chest.js',
    );

    dispatchEntityScript('chest', 'onEnter', anyCtx, {
      itemId: 1,
      renamedAway: 5,
    });

    expect(onEnter.mock.calls[0]?.[0].params).toEqual({ itemId: 1 });
  });

  // A behaviour may treat a param as optional in one path and required in
  // another, so this runs and logs: refusing would be the silent failure the
  // mechanism exists to avoid.
  it('still runs when a required param is empty', () => {
    const onEnter = vi.fn();
    registerEntityBehavior(
      'chest',
      { params: { itemId: { type: 'item', required: true } }, onEnter },
      'chest.js',
    );

    expect(dispatchEntityScript('chest', 'onEnter', anyCtx, {})).toBe(true);
    expect(onEnter.mock.calls[0]?.[0].params).toEqual({});
  });

  // Loud at load time, and the only place it can be loud: the field would
  // otherwise be missing from the editor and undefined in the handler.
  it('refuses to register a malformed declaration', () => {
    expect(() =>
      registerEntityBehavior(
        'chest',
        { params: { itemId: { type: 'sprite' } } },
        'chest.js',
      ),
    ).toThrow(/invalid params declaration/);

    expect(getEntityBehavior('chest')).toBeUndefined();
  });
});

describe('describeBehaviors', () => {
  it('reports the events implemented and the params declared, sorted by id', () => {
    registerEntityBehavior('sage', { onInteract: vi.fn() }, 'npcs.js');
    registerEntityBehavior(
      'chest',
      {
        params: { itemId: { type: 'item', label: 'Reward' } },
        onEnter: vi.fn(),
        onUse: vi.fn(),
      },
      'chest.js',
    );

    expect(describeBehaviors()).toEqual([
      {
        id: 'chest',
        owner: 'chest.js',
        events: ['onEnter', 'onUse'],
        params: [{ key: 'itemId', type: 'item', label: 'Reward' }],
      },
      { id: 'sage', owner: 'npcs.js', events: ['onInteract'], params: [] },
    ]);
  });
});

describe('registeredBehaviorParams', () => {
  it('lists every registered id with what it declares, for validating content', () => {
    registerEntityBehavior(
      'a',
      { params: { qty: { type: 'number' } } },
      'x.js',
    );
    registerEntityBehavior('b', {}, 'y.js');

    const registered = registeredBehaviorParams();
    expect([...registered.keys()]).toEqual(['a', 'b']);
    expect(registered.get('a')).toEqual([{ key: 'qty', type: 'number' }]);
    expect(registered.get('b')).toEqual([]);
  });

  it('is a copy, so a caller cannot corrupt the registry', () => {
    registerEntityBehavior('a', {}, 'x.js');
    (registeredBehaviorParams() as Map<string, never[]>).set('fake', []);

    expect([...registeredBehaviorParams().keys()]).toEqual(['a']);
  });
});
