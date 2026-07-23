import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TILE_SIZE, MOVEMENT_DURATION } from '../../../../shared/constants';
import { CharacterAction, Direction, Position } from '../../../../shared/types';
import { setStaticMap, setPlayerStats } from '../../../core/gameState';
import {
  getAnimatedState,
  clearMovementQueues,
} from '../../../graphics/movementAnimation';

function animatedPos(id: string, current: Position): Position {
  return getAnimatedState(id, current).position;
}
import {
  enqueueGameStateMessage,
  updateWebSocket,
  resetInterpolation,
} from './gameStateSync';

const LOCAL_ID = 'me';
let now = 1000;

function hotPlayer(position: Position) {
  return {
    id: LOCAL_ID,
    position,
    direction: Direction.Right,
    action: CharacterAction.Walk,
    health: 100,
  };
}

// One per-tick world update carrying only the local player's hot state, which
// is what a solo player actually receives from the server.
function enqueueFull(position: Position) {
  enqueueGameStateMessage({
    v: 1,
    type: 'worldUpdate',
    payload: { entities: {}, leave: [], self: hotPlayer(position) },
  } as never);
}

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  clearMovementQueues();
  resetInterpolation();
  setStaticMap({
    id: '1',
    name: 'M',
    type: 'normal',
    tiles: [[{ tileIndex: 0, blocked: false }]],
  });
  setPlayerStats({
    id: LOCAL_ID,
    name: 'Me',
    sprite: 0,
    width: 64,
    height: 64,
    maxHealth: 100,
    attack: 10,
    attackRange: 64,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    inventory: [],
    equipped: {},
    access: 0,
    strength: 0,
    defense: 0,
    agility: 0,
    vitality: 0,
    unspentPoints: 0,
    speed: 1,
    mapId: '1',
    kind: 'player',
  });
});

afterEach(() => vi.restoreAllMocks());

describe('local player movement pipeline', () => {
  it('slides the local player from the old to the new server position', () => {
    enqueueFull({ x: 0, y: 0 });
    updateWebSocket();

    enqueueFull({ x: TILE_SIZE, y: 0 });
    updateWebSocket();

    expect(animatedPos(LOCAL_ID, { x: TILE_SIZE, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });

    now = 1000 + MOVEMENT_DURATION / 2;
    expect(animatedPos(LOCAL_ID, { x: TILE_SIZE, y: 0 })).toEqual({
      x: TILE_SIZE / 2,
      y: 0,
    });
  });

  it('slides when the move arrives as an incremental worldUpdate (the real path)', () => {
    enqueueFull({ x: 0, y: 0 });
    updateWebSocket();

    enqueueFull({ x: TILE_SIZE, y: 0 });
    updateWebSocket();

    now = 1000 + MOVEMENT_DURATION / 2;
    expect(animatedPos(LOCAL_ID, { x: TILE_SIZE, y: 0 })).toEqual({
      x: TILE_SIZE / 2,
      y: 0,
    });
  });

  it('plays two batched moves sequentially instead of jumping two tiles', () => {
    enqueueFull({ x: 0, y: 0 });
    updateWebSocket();

    // both arrive in the same frame (a client hitch)
    enqueueFull({ x: TILE_SIZE, y: 0 });
    enqueueFull({ x: 2 * TILE_SIZE, y: 0 });
    updateWebSocket();

    const D = MOVEMENT_DURATION;
    const target = { x: 2 * TILE_SIZE, y: 0 };

    now = 1000 + D / 2;
    expect(animatedPos(LOCAL_ID, target)).toEqual({ x: TILE_SIZE / 2, y: 0 });

    now = 1000 + D;
    expect(animatedPos(LOCAL_ID, target)).toEqual({ x: TILE_SIZE, y: 0 });

    // the second move must still be sliding here, not already jumped to 2 tiles
    now = 1000 + 1.5 * D;
    expect(animatedPos(LOCAL_ID, target)).toEqual({
      x: 1.5 * TILE_SIZE,
      y: 0,
    });
  });
});
