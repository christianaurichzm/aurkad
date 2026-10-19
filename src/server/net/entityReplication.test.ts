import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginTick,
  recordEntity,
  fragmentAt,
  gapDelta,
  fieldDelta,
  forgetEntity,
  resetEntityReplication,
  resyncBody,
} from './entityReplication.js';

beforeEach(() => {
  resetEntityReplication();
});

describe('fieldDelta', () => {
  it('returns null when nothing changed', () => {
    const a = { id: 'x', health: 10, position: { x: 1, y: 2 } };
    expect(fieldDelta(a, { ...a, position: { x: 1, y: 2 } })).toBeNull();
  });

  it('compares nested position by value, not identity', () => {
    const prev = { position: { x: 1, y: 2 } };
    // A fresh object with the same coordinates must not count as a change.
    expect(fieldDelta(prev, { position: { x: 1, y: 2 } })).toBeNull();
    expect(fieldDelta(prev, { position: { x: 1, y: 3 } })).toEqual({
      position: { x: 1, y: 3 },
    });
  });

  it('includes only the fields that changed', () => {
    const prev = { id: 'x', health: 10, action: 'Idle', level: 3 };
    const next = { id: 'x', health: 7, action: 'Attack', level: 3 };
    expect(fieldDelta(prev, next)).toEqual({ health: 7, action: 'Attack' });
  });

  // Cleared fields must survive JSON.stringify, which drops undefined-valued
  // keys, so null is the explicit "cleared" marker.
  it('encodes a field that disappeared as null, and survives serialization', () => {
    const delta = fieldDelta({ id: 'x', nameTag: 'Guild' }, { id: 'x' });
    expect(delta).toEqual({ nameTag: null });
    expect(JSON.parse(JSON.stringify(delta))).toEqual({ nameTag: null });
  });

  it('encodes a field set to undefined as null too', () => {
    // e.g. targetPosition once a player stops moving.
    const delta = fieldDelta(
      { id: 'x', targetPosition: { x: 1, y: 1 } },
      { id: 'x', targetPosition: undefined },
    );
    expect(delta).toEqual({ targetPosition: null });
    expect(JSON.stringify(delta)).toContain('targetPosition');
  });
});

describe('fragmentAt', () => {
  it('gives a viewer that does not know the entity the full state', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });

    const fragment = fragmentAt('a')?.full;
    expect(fragment).toBeDefined();
    expect(JSON.parse(fragment!)).toEqual({ id: 'a', health: 10 });
  });

  it('gives a viewer that knows the entity only the changed fields', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10, action: 'Idle' });
    beginTick();
    recordEntity('a', { id: 'a', health: 4, action: 'Idle' });

    expect(JSON.parse(fragmentAt('a')!.delta!)).toEqual({ health: 4 });
    // Someone seeing it for the first time still needs all of it.
    expect(JSON.parse(fragmentAt('a')!.full)).toEqual({
      id: 'a',
      health: 4,
      action: 'Idle',
    });
  });

  it('sends nothing to a viewer that knows an unchanged entity', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });

    expect(fragmentAt('a')?.delta).toBeUndefined();
  });

  it('returns nothing for an entity not recorded this tick', () => {
    beginTick();
    expect(fragmentAt('ghost')).toBeUndefined();
  });

  it('serializes each entity once and reuses it across viewers', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });
    // Identical string instance is the whole point: no per-viewer work.
    expect(fragmentAt('a')).toBe(fragmentAt('a'));
  });
});

describe('gapDelta', () => {
  function record(states: Array<Record<string, unknown>>) {
    for (const state of states) {
      beginTick();
      recordEntity('a', state);
    }
    return fragmentAt('a')!;
  }

  it('merges the ticks a viewer missed into one body', () => {
    const fragment = record([
      { id: 'a', health: 10, action: 'Idle' },
      { id: 'a', health: 8, action: 'Idle' },
      { id: 'a', health: 8, action: 'Attack' },
    ]);

    // Two ticks back covers both changes; one tick back covers only the last.
    expect(JSON.parse(gapDelta(fragment, 2)!)).toEqual({
      health: 8,
      action: 'Attack',
    });
    expect(JSON.parse(gapDelta(fragment, 1)!)).toEqual({ action: 'Attack' });
  });

  it('keeps the latest value when a field moved more than once', () => {
    const fragment = record([
      { id: 'a', health: 10 },
      { id: 'a', health: 9 },
      { id: 'a', health: 7 },
    ]);

    expect(JSON.parse(gapDelta(fragment, 2)!)).toEqual({ health: 7 });
  });

  // The history is short, and a viewer away longer than it has to be
  // told so rather than handed a merge that skips what fell off the end.
  it('gives no answer for a gap longer than the history', () => {
    const fragment = record([
      { id: 'a', health: 10 },
      { id: 'a', health: 9 },
      { id: 'a', health: 8 },
      { id: 'a', health: 7 },
      { id: 'a', health: 6 },
      { id: 'a', health: 5 },
    ]);

    expect(gapDelta(fragment, 4)).not.toBeNull();
    expect(gapDelta(fragment, 5)).toBeNull();
  });

  it('gives no answer when the entity was not recorded inside the span', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });
    beginTick(); // the entity is not recorded on this one (dead npc, say)
    beginTick();
    recordEntity('a', { id: 'a', health: 4 });

    const fragment = fragmentAt('a')!;
    expect(gapDelta(fragment, 2)).toBeNull();
    expect(gapDelta(fragment, 3)).toBeNull();
  });

  it('does not answer with the changes of a slot the entity inherited', () => {
    beginTick();
    recordEntity('gone', { id: 'gone', health: 10 });
    beginTick();
    recordEntity('gone', { id: 'gone', health: 3 });
    forgetEntity('gone');

    beginTick();
    recordEntity('new', { id: 'new', health: 50 });
    beginTick();
    recordEntity('new', { id: 'new', health: 49 });

    const fragment = fragmentAt('new')!;
    // The slot is the freed one, so a merge that trusted the ring blindly would
    // hand out the dead entity's history.
    expect(gapDelta(fragment, 3)).toBeNull();
    expect(JSON.parse(gapDelta(fragment, 2)!)).toEqual({ health: 49 });
  });
});

describe('resyncBody', () => {
  it('spells out a field that went away, which the full state cannot', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10, targetPosition: { x: 1, y: 2 } });
    beginTick();
    recordEntity('a', { id: 'a', health: 10, targetPosition: undefined });

    const fragment = fragmentAt('a')!;
    // What an entity entering a viewport gets is inserted whole, so the key is
    // simply absent there. A viewer that already holds the entity merges, and
    // for it the key has to arrive as an explicit clear or it never goes away.
    expect(JSON.parse(fragment.full)).toEqual({ id: 'a', health: 10 });
    expect(JSON.parse(resyncBody(fragment))).toEqual({
      id: 'a',
      health: 10,
      targetPosition: null,
    });
  });

  // An npc serializer spreads the entity, so a field the editor cleared is
  // left out rather than undefined, and a viewer back from a long gap may
  // still hold it.
  it('clears a field the state left out since the viewer last heard', () => {
    beginTick();
    recordEntity('a', { id: 'a', dialogId: 'greet' });
    beginTick();
    recordEntity('a', { id: 'a' });
    for (let i = 0; i < 10; i++) {
      beginTick();
      recordEntity('a', { id: 'a' });
    }

    expect(JSON.parse(resyncBody(fragmentAt('a')!))).toEqual({
      id: 'a',
      dialogId: null,
    });
  });

  it('builds the body once per entity per tick', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });

    const fragment = fragmentAt('a')!;
    expect(resyncBody(fragment)).toBe(resyncBody(fragment));
  });
});

describe('forgetEntity', () => {
  it('drops history so a recycled id cannot inherit another entity state', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });
    forgetEntity('a');

    beginTick();
    recordEntity('a', { id: 'a', health: 99 });
    // With no history the entity must be treated as new: full state, no delta.
    expect(fragmentAt('a')?.delta).toBeUndefined();
    expect(JSON.parse(fragmentAt('a')!.full)).toEqual({
      id: 'a',
      health: 99,
    });
  });
});
