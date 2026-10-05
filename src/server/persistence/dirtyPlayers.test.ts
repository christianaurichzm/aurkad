import { describe, it, expect, beforeEach } from 'vitest';
import {
  markPlayerDirty,
  clearPlayerDirty,
  drainDirtyPlayerIds,
  beginPlayerCommit,
  endPlayerCommit,
  isPlayerCommitting,
} from './dirtyPlayers.js';

beforeEach(() => {
  drainDirtyPlayerIds();
});

describe('dirty players', () => {
  it('keeps a player held until every overlapping commit ends', () => {
    beginPlayerCommit(['overlap']);
    beginPlayerCommit(['overlap']);
    endPlayerCommit(['overlap']);
    expect(isPlayerCommitting('overlap')).toBe(true);
    endPlayerCommit(['overlap']);
    expect(isPlayerCommitting('overlap')).toBe(false);
  });
  it('drains the marked ids and resets the set', () => {
    markPlayerDirty('a');
    markPlayerDirty('b');
    markPlayerDirty('a');

    expect(drainDirtyPlayerIds().sort()).toEqual(['a', 'b']);
    expect(drainDirtyPlayerIds()).toEqual([]);
  });

  it('clears a single id without touching the rest', () => {
    markPlayerDirty('a');
    markPlayerDirty('b');
    clearPlayerDirty('a');

    expect(drainDirtyPlayerIds()).toEqual(['b']);
  });
});
