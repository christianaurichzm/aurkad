import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CharacterAction,
  Direction,
  PlayerServer,
} from '../../../shared/types.js';
import {
  toPlayerCold,
  awardExperience,
  handlePlayerUpdates,
  enterWorld,
  persistPlayerSessionState,
  setAccess,
} from './playerService.js';
import { on, clearAll } from '../../engine/hooks.js';
import { createFixture, makeTiles, tile } from '../../sim/simFixture.js';
import { getPlayerByName } from '../../sim/world.js';
import { gameConfig } from '../../gameConfig.js';
import { items } from '../world/gameData.js';
import { unequipItem } from '../economy/inventoryService.js';

const { recordAdminAction } = vi.hoisted(() => ({
  recordAdminAction: vi.fn(),
}));
vi.mock('../auditService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auditService.js')>()),
  recordAdminAction,
}));
vi.mock('../../persistence/playerRepository.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../persistence/playerRepository.js')
    >();
  return {
    playerRepository: {
      ...actual.playerRepository,
      save: () => Promise.resolve(true),
    },
  };
});

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

  it('says how much the bag holds', () => {
    const cold = toPlayerCold(
      mkPlayer({ inventory: { items: [], maxCapacity: 24 } }),
    );

    expect(cold.inventoryCapacity).toBe(24);
  });

  it('carries nameColor, nameTag and its colour through serialization', () => {
    const cold = toPlayerCold(
      mkPlayer({
        nameColor: 'gold',
        nameTag: '[Dragons]',
        nameTagColor: 'purple',
      }),
    );
    expect(cold.nameColor).toBe('gold');
    expect(cold.nameTag).toBe('[Dragons]');
    expect(cold.nameTagColor).toBe('purple');
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

  it('awards nothing in a game with levels turned off', () => {
    const leveling = gameConfig.leveling;
    gameConfig.leveling = { ...leveling, enabled: false };
    try {
      const player = mkPlayer({ experience: 0, experienceToNextLevel: 100 });
      expect(awardExperience(player, 500, 'kill')).toBe(0);
      expect(player).toMatchObject({ level: 1, experience: 0 });
    } finally {
      gameConfig.leveling = leveling;
    }
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

describe('access changed outside setAccess', () => {
  beforeEach(() => recordAdminAction.mockClear());

  it('lands in the audit trail on the next save, once, and stays', async () => {
    const fx = createFixture();
    const player = mkPlayer({ mapId: fx.mapId });
    enterWorld(player);

    player.access = 2;
    await persistPlayerSessionState(player);
    await persistPlayerSessionState(player);

    expect(player.access).toBe(2);
    expect(recordAdminAction).toHaveBeenCalledTimes(1);
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'access-drift',
        target: 'P',
        source: 'script',
        details: { from: 0, to: 2 },
      }),
    );
  });

  it('is not reported when it went through setAccess', async () => {
    const fx = createFixture();
    const player = mkPlayer({ mapId: fx.mapId });
    enterWorld(player);

    setAccess(player, 2);
    await persistPlayerSessionState(player);

    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});

describe('entering the world', () => {
  it.each([
    {
      label: 'past the far corner after a resize',
      position: tile(40, 30),
      cols: 8,
      rows: 6,
      expected: tile(7, 5),
    },
    {
      label: 'before the origin',
      position: tile(-3, -2),
      cols: 8,
      rows: 6,
      expected: tile(0, 0),
    },
    {
      label: 'on a one-tile map',
      position: tile(5, 5),
      cols: 1,
      rows: 1,
      expected: tile(0, 0),
    },
  ])(
    'registers a saved player $label at a position visible to the join hook',
    ({ position, cols, rows, expected }) => {
      const fx = createFixture();
      fx.map.tiles = makeTiles(rows, cols);
      const player = mkPlayer({ mapId: fx.mapId, position });
      const joined = vi.fn();
      const off = on('playerJoin', ({ player }) =>
        joined({ ...player.position }),
      );
      try {
        const map = enterWorld(player);

        expect(player.position).toEqual(expected);
        expect(joined).toHaveBeenCalledWith(expected);
        expect(map?.players[player.id]).toBe(player);
        expect(getPlayerByName(player.name)).toBe(player);
      } finally {
        off();
      }
    },
  );

  it('pins what an unrecorded slot gives, so deleting the item cannot strand it', () => {
    const fx = createFixture();
    items.set(77, {
      id: 77,
      name: 'Old Gloves',
      description: '',
      sprite: 0,
      type: 'gloves',
      effects: [{ attribute: 'attack', type: 'add', value: 4 }],
    });
    // Saved before equipping kept a record: the bonus is in the stats, and
    // the slot names the item and nothing else.
    const player = mkPlayer({
      mapId: fx.mapId,
      attack: 14,
      equipped: { gloves: 77 },
    });

    enterWorld(player);
    items.delete(77);
    unequipItem(player, 'gloves');

    expect(player.attack).toBe(10);
  });
});
