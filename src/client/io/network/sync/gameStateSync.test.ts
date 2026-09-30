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
import { playSound } from '../../../audio';

vi.mock('../../../audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../audio')>()),
  playSound: vi.fn(),
}));

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
  vi.mocked(playSound).mockClear();
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  clearMovementQueues();
  resetInterpolation();
  setStaticMap({
    id: '1',
    name: 'M',
    type: 'normal',
    tiles: [[{ tileIndex: 0 }]],
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
    inventoryCapacity: 10,
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

// `action` is in every visible entity's per-tick snapshot, so a swing next to
// you needs no event of its own.
describe('attack sounds from other entities', () => {
  const enqueueOther = (action: CharacterAction, position: Position) =>
    enqueueGameStateMessage({
      v: 1,
      type: 'worldUpdate',
      payload: {
        entities: {
          bob: {
            id: 'bob',
            kind: 'player',
            position,
            direction: Direction.Right,
            action,
          },
        },
        leave: [],
        self: hotPlayer({ x: 0, y: 0 }),
      },
    } as never);

  it('plays one placed sound on the edge into Attack, not every tick', () => {
    enqueueOther(CharacterAction.Idle, { x: 128, y: 0 });
    updateWebSocket();

    enqueueOther(CharacterAction.Attack, { x: 128, y: 0 });
    updateWebSocket();

    expect(playSound).toHaveBeenCalledExactlyOnceWith('attack.mp3', {
      x: 128,
      y: 0,
    });

    // still attacking on the next update: the same swing, not a second one
    enqueueOther(CharacterAction.Attack, { x: 128, y: 0 });
    updateWebSocket();

    expect(playSound).toHaveBeenCalledTimes(1);
  });

  // Someone who walks into view mid-swing did not just swing at you.
  it('stays quiet for an entity seen for the first time', () => {
    enqueueOther(CharacterAction.Attack, { x: 128, y: 0 });
    updateWebSocket();

    expect(playSound).not.toHaveBeenCalled();
  });
});
