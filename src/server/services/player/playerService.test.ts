import { describe, it, expect, beforeEach } from 'vitest';
import {
  CharacterAction,
  Direction,
  PlayerServer,
} from '../../../shared/types.js';
import {
  toPlayerCold,
  awardExperience,
  handlePlayerUpdates,
} from './playerService.js';
import { on, clearAll } from '../../engine/hooks.js';
import { createFixture } from '../../sim/simFixture.js';
import { getPlayerByName } from '../../sim/world.js';

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

// F-4: handlePlayerUpdates must not swap the registered player object's
// identity. A reference held elsewhere (in-flight combat, a script, an async
// op mid-await) would otherwise become detached and its later mutations
// would be lost.
describe('handlePlayerUpdates identity (F-4)', () => {
  it('keeps the registered object identity stable across an update', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', sprite: 0 });
    const held = getPlayerByName('Alice');

    handlePlayerUpdates({ ...alice, sprite: 7 });

    const after = getPlayerByName('Alice');
    expect(after?.sprite).toBe(7);
    expect(after).toBe(held);
  });

  it('does not detach a reference held before the update', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const held = getPlayerByName('Alice')!;

    handlePlayerUpdates({ ...alice, sprite: 9 });

    // A mutation through the pre-update reference must still be visible via
    // the registry, as they have to be the same object.
    held.health = 42;
    expect(getPlayerByName('Alice')?.health).toBe(42);
  });

  it('map.players and the name index resolve to the same object after update', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    handlePlayerUpdates({ ...alice, sprite: 3 });

    const byName = getPlayerByName('Alice');
    expect(sim.map.players[alice.id]).toBe(byName);
  });
});
