import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginTick,
  recordEntity,
  fragmentFor,
  fieldDelta,
  forgetEntity,
  resetEntityReplication,
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

describe('fragmentFor', () => {
  it('gives a viewer that does not know the entity the full state', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });

    const fragment = fragmentFor('a', false);
    expect(fragment).toBeDefined();
    expect(JSON.parse(fragment!)).toEqual({ id: 'a', health: 10 });
  });

  it('gives a viewer that knows the entity only the changed fields', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10, action: 'Idle' });
    beginTick();
    recordEntity('a', { id: 'a', health: 4, action: 'Idle' });

    expect(JSON.parse(fragmentFor('a', true)!)).toEqual({ health: 4 });
    // Someone seeing it for the first time still needs all of it.
    expect(JSON.parse(fragmentFor('a', false)!)).toEqual({
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

    expect(fragmentFor('a', true)).toBeUndefined();
  });

  it('returns nothing for an entity not recorded this tick', () => {
    beginTick();
    expect(fragmentFor('ghost', false)).toBeUndefined();
  });

  it('serializes each entity once and reuses it across viewers', () => {
    beginTick();
    recordEntity('a', { id: 'a', health: 10 });
    // Identical string instance is the whole point: no per-viewer work.
    expect(fragmentFor('a', false)).toBe(fragmentFor('a', false));
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
    expect(fragmentFor('a', true)).toBeUndefined();
    expect(JSON.parse(fragmentFor('a', false)!)).toEqual({
      id: 'a',
      health: 99,
    });
  });
});
