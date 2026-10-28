import { describe, it, expect, beforeEach, onTestFinished, vi } from 'vitest';
import fc from 'fast-check';
import WebSocket from 'ws';
import {
  CharacterAction,
  Direction,
  Key,
  PlayerServer,
} from '../../../shared/types.js';
import {
  awardExperience,
  handlePlayerUpdates,
  enterWorld,
  disconnectPlayer,
  persistPlayerSessionState,
  persistPlayersOnShutdown,
  refuseEntry,
  resumePlayer,
  setAccess,
} from './playerService.js';
import { on, clearAll } from '../../engine/hooks.js';
import { createFixture, makeTiles, tile } from '../../sim/simFixture.js';
import { getAllPlayers, getPlayerByName } from '../../sim/world.js';
import { runtimeState } from '../../sim/state.js';
import { msToTicks } from '../../sim/clock.js';
import { gameConfig } from '../../gameConfig.js';
import { getMetrics } from '../../metrics.js';
import { playersWsMap } from '../../net/connections.js';
import {
  replicatedEntityCount,
  resetEntityReplication,
} from '../../net/entityReplication.js';
import { resetPlayerNetState } from '../../net/viewerState.js';
import { enqueueClientAction } from '../../net/transport.js';
import { clearPlayerDirty } from '../../persistence/dirtyPlayers.js';
import { playerRepository } from '../../persistence/playerRepository.js';
import { items } from '../content/itemService.js';
import { resolveDamage } from '../combat/index.js';
import { clearDamageContributions } from '../combat/damage.js';
import { unequipItem } from '../economy/inventoryService.js';
import { despawnNpc, spawnNpc } from '../npc/spawn.js';
import { warpToMap } from '../world/movementService.js';
import {
  clearInstancesForTest,
  sweepInstances,
} from '../world/instanceService.js';

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

const presence = vi.hoisted(() => ({ releaseFails: false }));
vi.mock('../../persistence/presence.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../persistence/presence.js')>();
  return {
    ...actual,
    releasePresence: (id: string) =>
      presence.releaseFails
        ? Promise.reject(new Error('database unavailable'))
        : actual.releasePresence(id),
  };
});

// No database in this file: a resumed session asks about bans on the way in.
vi.mock('./banService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./banService.js')>()),
  getBan: () => Promise.resolve(null),
  activeBan: () => Promise.resolve(null),
}));

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

// handlePlayerUpdates must not swap the registered player object's
// identity. A reference held elsewhere (in-flight combat, a script, an async
// op mid-await) would otherwise become detached and its later mutations
// would be lost.
describe('handlePlayerUpdates identity', () => {
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

  it('puts a character saved on a dungeon map in a copy of its own', () => {
    const fx = createFixture();
    fx.map.instanced = true;
    onTestFinished(clearInstancesForTest);
    const ann = mkPlayer({ id: 'a', name: 'Ann', mapId: fx.mapId });
    const bo = mkPlayer({ id: 'b', name: 'Bo', mapId: fx.mapId });

    const annMap = enterWorld(ann);
    const boMap = enterWorld(bo);

    expect(annMap?.id).toBe(ann.mapId);
    expect(boMap?.id).toBe(bo.mapId);
    expect(ann.mapId).not.toBe(bo.mapId);
    expect(fx.map.players).toEqual({});
  });

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

describe('leaving the world', () => {
  const NAMES = ['Ann', 'Bo', 'Cy'];
  const MAPS = ['map1', 'map2'];
  // A warp can also lead into a dungeon, which is entered as a copy of its own.
  const WARP_TO = [...MAPS, 'dungeon'];
  const RESPAWN_MS = 500;

  type Op =
    | { kind: 'join'; who: number; map: number; col: number; row: number }
    | { kind: 'leave'; who: number }
    | { kind: 'press' | 'release'; who: number; key: Key }
    | { kind: 'walkTo'; who: number; col: number; row: number }
    | { kind: 'warp'; who: number; to: number; col: number; row: number }
    | { kind: 'sweep' }
    | {
        kind: 'summon';
        map: number;
        col: number;
        row: number;
        behavior: 'aggressive' | 'neutral';
      }
    | { kind: 'hit'; npc: number; by: number; lethal: boolean }
    | { kind: 'dismiss'; npc: number }
    | { kind: 'tick'; ticks: number };

  const who = fc.nat({ max: NAMES.length - 1 });
  const map = fc.nat({ max: MAPS.length - 1 });
  const cell = fc.nat({ max: 19 });
  const op: fc.Arbitrary<Op> = fc.oneof(
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('join'),
        who,
        map,
        col: cell,
        row: cell,
      }),
    },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('leave'), who }) },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constantFrom('press', 'release'),
        who,
        key: fc.constantFrom(Key.ArrowRight, Key.ArrowDown, Key.Control),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('walkTo'),
        who,
        col: cell,
        row: cell,
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('warp'),
        who,
        to: fc.nat({ max: WARP_TO.length - 1 }),
        col: cell,
        row: cell,
      }),
    },
    { weight: 1, arbitrary: fc.constant({ kind: 'sweep' as const }) },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('summon'),
        map,
        col: cell,
        row: cell,
        behavior: fc.constantFrom('aggressive', 'neutral'),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('hit'),
        npc: fc.nat({ max: 7 }),
        by: who,
        lethal: fc.boolean(),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant('dismiss'), npc: fc.nat(7) }),
    },
    {
      weight: 4,
      arbitrary: fc.record({
        kind: fc.constant('tick'),
        ticks: fc.integer({ min: 1, max: 12 }),
      }),
    },
  );

  const socket = () =>
    ({
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: () => {},
      close: () => {},
    }) as unknown as WebSocket;

  const npcsOnMaps = () =>
    Object.values(runtimeState.maps)
      .flatMap((m) => Object.values(m.npcs))
      .sort((a, b) => a.id.localeCompare(b.id));

  // Every id a run can leave state under, so a failed run does not hand its
  // leak to the next one while fast-check shrinks.
  const npcIds = new Set<string>();

  function freshWorld() {
    clearInstancesForTest();
    const sim = createFixture(0);
    sim.addMap({ id: 'map2' });
    const imp = sim.addNpc({
      id: 'imp:3:3',
      mapId: 'dungeon',
      position: tile(3, 3),
      attack: 0,
    });
    delete sim.map.npcs[imp.id];
    sim.addMap({ id: 'dungeon', instanced: true, npcs: { [imp.id]: imp } });
    resetEntityReplication();
    NAMES.forEach((name, i) => {
      resetPlayerNetState(name);
      clearPlayerDirty(`p${i}`);
      clearDamageContributions(`p${i}`);
    });
    npcIds.forEach(clearDamageContributions);
    playersWsMap.clear();

    // One that is back on its tile the moment it dies and one that is off the
    // map for a while first: the two ways a content npc respawns. The xp is
    // what makes a kill write to its killer, and so mark them dirty.
    for (const [template, col, respawnMs] of [
      ['rat', 2, undefined],
      ['wolf', 4, RESPAWN_MS],
    ] as const) {
      sim.map.tiles[2]![col]!.npcSpawn = template;
      const npc = sim.addNpc({
        id: `${template}:2:${col}`,
        templateId: template,
        position: tile(col, 2),
        attack: 0,
        experienceValue: 1,
        respawnMs,
      });
      npcIds.add(npc.id);
    }
    return sim;
  }

  async function leave(name: string) {
    await disconnectPlayer(name);
    // What the socket's close handler does after handing the departure over.
    playersWsMap.delete(name);
  }

  async function apply(sim: ReturnType<typeof createFixture>, o: Op) {
    const name = 'who' in o ? NAMES[o.who]! : '';
    const player = getPlayerByName(name);
    switch (o.kind) {
      case 'join':
        if (player) return;
        enterWorld(
          mkPlayer({
            id: `p${o.who}`,
            name,
            mapId: MAPS[o.map]!,
            position: tile(o.col, o.row),
          }),
        );
        playersWsMap.set(name, socket());
        return;
      case 'leave':
        if (player) await leave(name);
        return;
      case 'press':
      case 'release':
        enqueueClientAction({
          username: name,
          type: 'keyboard',
          keyboardAction: { key: o.key, type: o.kind },
        });
        return;
      case 'walkTo':
        enqueueClientAction({
          username: name,
          type: 'moveTo',
          col: o.col,
          row: o.row,
        });
        return;
      case 'warp':
        if (player) warpToMap(player, WARP_TO[o.to]!, tile(o.col, o.row));
        return;
      case 'sweep':
        sweepInstances();
        return;
      case 'summon': {
        const npc = spawnNpc({
          mapId: MAPS[o.map]!,
          col: o.col,
          row: o.row,
          maxHealth: 3,
          behavior: o.behavior,
        });
        if (npc) npcIds.add(npc.id);
        return;
      }
      case 'hit': {
        const npcs = npcsOnMaps();
        const target = npcs[o.npc % Math.max(1, npcs.length)];
        if (!target) return;
        const attacker = getPlayerByName(NAMES[o.by]!);
        npcIds.add(target.id);
        resolveDamage(target, o.lethal ? target.health : 1, { attacker });
        return;
      }
      case 'dismiss': {
        const npcs = npcsOnMaps();
        const target = npcs[o.npc % Math.max(1, npcs.length)];
        if (target) despawnNpc(target);
        return;
      }
      case 'tick':
        sim.step(o.ticks);
        // A tick records every entity on a map somebody stands on, and a
        // baseline goes only with its entity, so one beyond those alive is one
        // nothing will ever look up again. The sweep at the end is the exact
        // check: with everybody gone, no baseline may be left.
        expect(replicatedEntityCount()).toBeLessThanOrEqual(
          getAllPlayers().length + npcsOnMaps().length,
        );
        return;
    }
  }

  it('leaves nothing keyed by a player or an npc behind', async () => {
    // So that a sweep closes whatever copy it finds empty the second time.
    const grace = gameConfig.world.instanceGraceMs;
    gameConfig.world.instanceGraceMs = 0;
    onTestFinished(() => {
      gameConfig.world.instanceGraceMs = grace;
    });
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 40 }), async (ops) => {
        const sim = freshWorld();
        // Other tests in this file leave players of their own behind, under
        // names and ids this one never uses.
        const before = getMetrics().caches;
        for (const o of ops) {
          await apply(sim, o);
          // Dead is off the map: one left on it is invisible to players and
          // untouchable by them, but not to the npc ai.
          for (const npc of npcsOnMaps()) {
            expect(npc.health).toBeGreaterThan(0);
          }
        }

        for (const name of NAMES) {
          if (getPlayerByName(name)) await leave(name);
        }
        // A wolf killed late is still on its way back, and would land after
        // the sweep below.
        sim.step(msToTicks(RESPAWN_MS));
        for (const npc of npcsOnMaps()) despawnNpc(npc);
        sim.step(1);

        // The caches /metrics publishes are exactly the ones keyed by a player
        // or an entity, so a new one is checked here as soon as it is.
        expect(getMetrics().caches).toEqual(before);
      }),
      {
        numRuns: 150,
        examples: [
          // Rarely drawn at random: a hit inside a copy that then closes.
          [
            [
              { kind: 'join', who: 0, map: 0, col: 0, row: 0 },
              { kind: 'warp', who: 0, to: 2, col: 0, row: 0 },
              { kind: 'hit', npc: 0, by: 0, lethal: false },
              { kind: 'warp', who: 0, to: 0, col: 0, row: 0 },
              { kind: 'sweep' },
              { kind: 'sweep' },
            ],
          ],
        ],
      },
    );
  });
});

// A logout or a kick ends the character and closes its socket, and the close
// asks for the same departure again.
describe('a departure asked for twice', () => {
  it('runs once, and keeps a new session out until it is done', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    let land = () => {};
    const save = vi
      .spyOn(playerRepository, 'save')
      .mockImplementationOnce(
        () => new Promise((resolve) => (land = () => resolve(true))),
      );
    onTestFinished(() => {
      land();
      save.mockRestore();
    });
    const record = { ...alice, password: 'hash' } as never;

    const first = disconnectPlayer('Alice');
    const second = disconnectPlayer('Alice');
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(await refuseEntry(record)).toMatchObject({ status: 503 });

    land();
    await Promise.all([first, second]);

    expect(save).toHaveBeenCalledOnce();
    expect(getPlayerByName('Alice')).toBeUndefined();
    expect(await refuseEntry(record)).toBeNull();
  });
});

describe('a departure the database cannot take', () => {
  it('leaves the world anyway and is written once the database is back', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    const save = vi
      .spyOn(playerRepository, 'save')
      .mockRejectedValueOnce(new Error('database unavailable'));
    onTestFinished(() => void save.mockRestore());

    await disconnectPlayer('Alice');

    expect(getPlayerByName('Alice')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toMatchObject({ name: 'Alice' });
  });

  it('is written at the doorway of the dungeon it left from', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    clearInstancesForTest();
    const sim = createFixture(0);
    sim.addMap({ id: 'dungeon', instanced: true });
    const alice = sim.addPlayer({ name: 'Alice', position: tile(4, 7) });
    warpToMap(alice, 'dungeon', tile(1, 1));
    const save = vi
      .spyOn(playerRepository, 'save')
      .mockRejectedValueOnce(new Error('database unavailable'));
    onTestFinished(() => void save.mockRestore());

    await disconnectPlayer('Alice');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(save.mock.calls[1]![0]).toMatchObject({
      mapId: sim.mapId,
      position: tile(4, 7),
    });
  });

  it('is written by the shutdown sweep when the process stops before the retry', async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    const save = vi
      .spyOn(playerRepository, 'save')
      .mockRejectedValueOnce(new Error('database unavailable'));
    onTestFinished(() => void save.mockRestore());

    await disconnectPlayer('Alice');

    expect(await persistPlayersOnShutdown(getAllPlayers())).toEqual({
      saved: 1,
      failed: 0,
    });
    expect(save.mock.calls[1]![0]).toMatchObject({ name: 'Alice' });
    await vi.advanceTimersByTimeAsync(5_000);
  });

  it('leaves the world when the lease cannot be handed back', async () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    presence.releaseFails = true;
    onTestFinished(() => void (presence.releaseFails = false));

    await disconnectPlayer('Alice');

    expect(getPlayerByName('Alice')).toBeUndefined();
  });
});

describe('resuming a session', () => {
  it('enters with what the instance letting go of the account wrote last', async () => {
    const fx = createFixture();
    const sword = { item: 2, quantity: 1 };
    const before = {
      ...mkPlayer({ name: 'Ann', mapId: fx.mapId }),
      inventory: { items: [sword], maxCapacity: 10 },
      password: 'hash',
    };
    // The sword went to another character in that session's last write,
    // which landed after the first read.
    const after = { ...before, inventory: { items: [], maxCapacity: 10 } };
    const read = vi
      .spyOn(playerRepository, 'findByName')
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    onTestFinished(() => void read.mockRestore());

    expect(await resumePlayer('Ann')).toBeNull();
    expect(getPlayerByName('Ann')?.inventory.items).toEqual([]);
  });

  it('waits out a departure under way, then enters again', async () => {
    const sim = createFixture(0);
    const ann = sim.addPlayer({ name: 'Ann' });
    let releaseSave!: () => void;
    const saveHeld = new Promise<void>((resolve) => (releaseSave = resolve));
    const save = vi
      .spyOn(playerRepository, 'save')
      .mockImplementation(async () => {
        await saveHeld;
        return true;
      });
    const read = vi
      .spyOn(playerRepository, 'findByName')
      .mockResolvedValue({ ...structuredClone(ann), password: 'hash' });
    onTestFinished(() => {
      save.mockRestore();
      read.mockRestore();
    });

    const leaving = disconnectPlayer('Ann');
    const resuming = resumePlayer('Ann');
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseSave();
    await leaving;

    expect(await resuming).toBeNull();
    expect(getPlayerByName('Ann')).toBeDefined();
  });
});

describe('writes of one player', () => {
  it('land in the order they were asked for, so a logout is the last word', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const landed: number[] = [];
    let releaseSweep!: () => void;
    const sweepHeld = new Promise<void>((resolve) => (releaseSweep = resolve));
    const save = vi
      .spyOn(playerRepository, 'save')
      .mockImplementationOnce(async (state) => {
        await sweepHeld;
        landed.push(state.experience);
        return true;
      })
      .mockImplementation((state) => {
        landed.push(state.experience);
        return Promise.resolve(true);
      });
    onTestFinished(() => void save.mockRestore());

    const sweep = persistPlayerSessionState(alice);
    alice.experience = 25;
    const logout = disconnectPlayer('Alice');
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseSweep();
    await Promise.all([sweep, logout]);

    expect(landed.at(-1)).toBe(25);
  });
});
