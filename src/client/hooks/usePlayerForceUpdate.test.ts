import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Player } from '../../shared/types';

const state = vi.hoisted((): { player: unknown } => ({ player: null }));

vi.mock('../core/gameState', () => ({
  getPlayer: () => state.player,
}));

import { usePlayerForceUpdate } from './usePlayerForceUpdate';

const withGold = (gold: number) =>
  ({ name: 'Rowan', gold }) as unknown as Player;

describe('usePlayerForceUpdate', () => {
  afterEach(() => vi.useRealTimers());

  // A shop must open on the player as they are now, not on the state from
  // when the game screen mounted.
  it('opens on the player as it is now, not as it was at mount', () => {
    state.player = withGold(10);
    const { result, rerender } = renderHook(
      ({ active }) => usePlayerForceUpdate(active),
      { initialProps: { active: false } },
    );

    state.player = withGold(40);
    rerender({ active: true });

    expect(result.current).toEqual(withGold(40));
  });

  it('keeps re-reading the player while it stays active', () => {
    vi.useFakeTimers();
    state.player = withGold(40);
    const { result } = renderHook(() => usePlayerForceUpdate(true));

    state.player = withGold(2);
    act(() => void vi.advanceTimersByTime(300));

    expect(result.current).toEqual(withGold(2));
  });
});
