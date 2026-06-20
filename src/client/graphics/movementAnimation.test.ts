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

import {
  onServerPositionUpdate,
  getAnimatedState,
} from './movementAnimation';

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

  it('slides linearly from the old to the new server position', () => {
    onServerPositionUpdate('e2', { x: 0, y: 0 }, { x: TILE_SIZE, y: 0 });

    expect(pos('e2', { x: TILE_SIZE, y: 0 })).toEqual({ x: 0, y: 0 });

    now = 1000 + D / 2;
    expect(pos('e2', { x: TILE_SIZE, y: 0 })).toEqual({ x: TILE_SIZE / 2, y: 0 });

    now = 1000 + D;
    expect(pos('e2', { x: TILE_SIZE, y: 0 })).toEqual({ x: TILE_SIZE, y: 0 });
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

    onServerPositionUpdate('e5', { x: TILE_SIZE, y: 0 }, { x: 2 * TILE_SIZE, y: 0 });

    now = 1000 + D + D / 2;
    expect(pos('e5', { x: 2 * TILE_SIZE, y: 0 })).toEqual({
      x: 1.5 * TILE_SIZE,
      y: 0,
    });
  });
});
