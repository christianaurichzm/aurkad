import { describe, it, expect } from 'vitest';
import {
  CharacterAction,
  Direction,
  PlayerServer,
} from '../../shared/types.js';
import { toPlayerCold } from './playerService.js';

function mkPlayer(overrides: Partial<PlayerServer> = {}): PlayerServer {
  return {
    id: 'p1',
    name: 'P',
    sprite: 0,
    width: 64,
    height: 64,
    maxHealth: 100,
    attack: 10,
    attackRange: 64,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    inventory: { items: [], maxCapacity: 10 },
    equipped: {},
    access: 0,
    vitality: 0,
    unspentPoints: 0,
    speed: 1,
    mapId: '1',
    position: { x: 0, y: 0 },
    direction: Direction.Down,
    action: CharacterAction.Idle,
    health: 100,
    kind: 'player',
    ...overrides,
  };
}

describe('toPlayerCold', () => {
  it('handles a player whose equipped/inventory were dropped by mongoose minimize', () => {
    const player = mkPlayer({
      equipped: undefined as unknown as PlayerServer['equipped'],
      inventory: undefined as unknown as PlayerServer['inventory'],
    });

    const cold = toPlayerCold(player);

    expect(cold.equipped).toEqual({});
    expect(cold.inventory).toEqual([]);
  });
});
