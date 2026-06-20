import { describe, it, expect, beforeEach } from 'vitest';
import {
  markPlayerDirty,
  clearPlayerDirty,
  drainDirtyPlayerIds,
} from './dirtyPlayers.js';

beforeEach(() => {
  drainDirtyPlayerIds();
});

describe('dirty players', () => {
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
