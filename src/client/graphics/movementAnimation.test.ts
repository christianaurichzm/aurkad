import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TILE_SIZE, MOVEMENT_DURATION } from '../../shared/constants';
import { Position } from '../../shared/types';

const { getGameStateMock, getPlayerMock } = vi.hoisted(() => ({
  getGameStateMock: vi.fn(),
  getPlayerMock: vi.fn(),
}));

vi.mock('../core/gameState', () => ({
  getGameState: getGameStateMock,
  getPlayer: getPlayerMock,
}));

import { onServerPositionUpdate, getAnimatedState } from './movementAnimation';

const D = MOVEMENT_DURATION;
let now = 1000;

function pos(id: string, current: Position): Position {
  return getAnimatedState(id, current).position;
}

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  getGameStateMock.mockReturnValue(null);
  getPlayerMock.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('movement interpolation', () => {
  it('returns the current position when there is no movement', () => {
    expect(pos('idle', { x: TILE_SIZE, y: TILE_SIZE })).toEqual({
      x: TILE_SIZE,
      y: TILE_SIZE,
    });
  });

  it('snaps instead of sliding when the jump is longer than a tile', () => {
    // A warp tile: the sprite belongs at the destination, not walking there.
    onServerPositionUpdate(
      'warped',
      { x: 0, y: 0 },
      { x: TILE_SIZE * 8, y: 0 },
    );

    const state = getAnimatedState('warped', { x: TILE_SIZE * 8, y: 0 });
    expect(state.position).toEqual({ x: TILE_SIZE * 8, y: 0 });
    expect(state.moving).toBe(false);
  });

  it('slides an npc over its own step time, not a player step', () => {
    getGameStateMock.mockReturnValue({
      players: {},
      npcs: { skeleton: { moveIntervalMs: 1250 } },
    });
    onServerPositionUpdate('skeleton', { x: 0, y: 0 }, { x: TILE_SIZE, y: 0 });

    now = 1000 + D;
    expect(getAnimatedState('skeleton', { x: TILE_SIZE, y: 0 }).moving).toBe(
      true,
    );
    now = 1000 + 1250;
    expect(pos('skeleton', { x: TILE_SIZE, y: 0 })).toEqual({
      x: TILE_SIZE,
      y: 0,
    });
  });

  it('drops a queued step when a teleport lands mid-slide', () => {
    onServerPositionUpdate('warped2', { x: 0, y: 0 }, { x: TILE_SIZE, y: 0 });
    now = 1000 + D / 2;
    onServerPositionUpdate(
      'warped2',
      { x: TILE_SIZE, y: 0 },
      { x: 0, y: TILE_SIZE * 5 },
    );

    expect(pos('warped2', { x: 0, y: TILE_SIZE * 5 })).toEqual({
      x: 0,
      y: TILE_SIZE * 5,
    });
  });

  it('slides linearly from the old to the new server position', () => {
    onServerPositionUpdate('e2', { x: 0, y: 0 }, { x: TILE_SIZE, y: 0 });

    expect(pos('e2', { x: TILE_SIZE, y: 0 })).toEqual({ x: 0, y: 0 });

    now = 1000 + D / 2;
    expect(pos('e2', { x: TILE_SIZE, y: 0 })).toEqual({
      x: TILE_SIZE / 2,
      y: 0,
    });

    now = 1000 + D;
    expect(pos('e2', { x: TILE_SIZE, y: 0 })).toEqual({ x: TILE_SIZE, y: 0 });
  });

  it('lands the slide on whole pixels, never between two', () => {
    onServerPositionUpdate(
      'e9',
      { x: 0, y: 0 },
      { x: TILE_SIZE, y: TILE_SIZE },
    );

    // A third of the way through a 64px step is 21.33px, and a sprite blitted
    // there is resampled across two pixels of the buffer for the whole slide.
    now = 1000 + D / 3;
    const mid = pos('e9', { x: TILE_SIZE, y: TILE_SIZE });

    expect(Number.isInteger(mid.x)).toBe(true);
    expect(Number.isInteger(mid.y)).toBe(true);
  });

  it('reports moving while a slide is in flight and idle once settled', () => {
    onServerPositionUpdate('e6', { x: 0, y: 0 }, { x: TILE_SIZE, y: 0 });

    now = 1000 + D / 2;
    expect(getAnimatedState('e6', { x: TILE_SIZE, y: 0 }).moving).toBe(true);

    now = 1000 + D;
    expect(getAnimatedState('e6', { x: TILE_SIZE, y: 0 }).moving).toBe(false);
  });

  it('ignores a zero-distance update', () => {
    onServerPositionUpdate(
      'e4',
      { x: TILE_SIZE, y: TILE_SIZE },
      { x: TILE_SIZE, y: TILE_SIZE },
    );

    expect(pos('e4', { x: TILE_SIZE, y: TILE_SIZE })).toEqual({
      x: TILE_SIZE,
      y: TILE_SIZE,
    });
  });

  it('plays sequential updates as a continuous slide', () => {
    onServerPositionUpdate('e5', { x: 0, y: 0 }, { x: TILE_SIZE, y: 0 });

    now = 1000 + D;
    expect(pos('e5', { x: TILE_SIZE, y: 0 })).toEqual({ x: TILE_SIZE, y: 0 });

    onServerPositionUpdate(
      'e5',
      { x: TILE_SIZE, y: 0 },
      { x: 2 * TILE_SIZE, y: 0 },
    );

    now = 1000 + D + D / 2;
    expect(pos('e5', { x: 2 * TILE_SIZE, y: 0 })).toEqual({
      x: 1.5 * TILE_SIZE,
      y: 0,
    });
  });
});
