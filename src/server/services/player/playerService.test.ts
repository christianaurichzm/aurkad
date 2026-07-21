import { describe, it, expect, beforeEach } from 'vitest';
import {
  CharacterAction,
  Direction,
  PlayerServer,
} from '../../../shared/types.js';
import { toPlayerCold, awardExperience } from './playerService.js';
import { on, clearAll } from '../../engine/hooks.js';

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
    strength: 0,
    defense: 0,
    agility: 0,
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

  it('carries nameColor and nameTag through serialization', () => {
    const cold = toPlayerCold(
      mkPlayer({ nameColor: 'gold', nameTag: '[Dragons]' }),
    );
    expect(cold.nameColor).toBe('gold');
    expect(cold.nameTag).toBe('[Dragons]');
  });
});

describe('awardExperience', () => {
  beforeEach(() => clearAll());

  it('adds the amount and triggers level up past the threshold', () => {
    const player = mkPlayer({
      experience: 0,
      experienceToNextLevel: 100,
      level: 1,
    });
    awardExperience(player, 120, 'kill');
    expect(player.level).toBe(2);
    expect(player.experience).toBe(20);
  });

  it('lets a beforeXpGain handler scale the amount (VIP 2x)', () => {
    on('beforeXpGain', (ctx) => {
      ctx.amount *= 2;
    });
    const player = mkPlayer({ experience: 0, experienceToNextLevel: 1000 });
    const gained = awardExperience(player, 50, 'kill');
    expect(gained).toBe(100);
    expect(player.experience).toBe(100);
  });

  it('passes the source to the hook', () => {
    let seen = '';
    on('beforeXpGain', (ctx) => {
      seen = ctx.source;
    });
    awardExperience(mkPlayer(), 10, 'quest');
    expect(seen).toBe('quest');
  });

  it('clamps negative or non-finite amounts to zero', () => {
    const player = mkPlayer({ experience: 5 });
    awardExperience(player, -100, 'script');
    awardExperience(player, NaN, 'script');
    expect(player.experience).toBe(5);
  });
});
