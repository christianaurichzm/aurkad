import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterAction, Direction, Key } from '../../../shared/types.js';
import type { RuntimeNpc } from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';

vi.mock('../../gameConfig.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../gameConfig.js')>();
  return {
    ...actual,
    gameConfig: {
      ...actual.gameConfig,
      world: { ...actual.gameConfig.world, instanceGraceMs: 2_000 },
    },
  };
});

const { createFixture } = await import('../../sim/simFixture.js');
const { on } = await import('../../engine/hooks.js');
const { setMapTile } = await import('./mapService.js');
const { runtimeState } = await import('../../sim/state.js');
const { warpToMap } = await import('./movementService.js');
const { buildApi } = await import('../../engine/scripting/api.js');
const {
  clearInstancesForTest,
  isInstanceKey,
  persistedLocation,
  sweepInstances,
} = await import('./instanceService.js');

type Sim = ReturnType<typeof createFixture>;
let sim: Sim;
const unsubscribes: (() => void)[] = [];

/** A dungeon with one goblin standing in it, and a warp on map1 leading in. */
function buildDungeon(): void {
  const dungeon = sim.addMap({ id: 'dungeon', instanced: true });
  const goblin: RuntimeNpc = {
    id: 'goblin:5:5',
    name: 'Goblin',
    sprite: 0,
    width: TILE_SIZE,
    height: TILE_SIZE,
    maxHealth: 30,
    health: 12,
    attack: 5,
    attackRange: TILE_SIZE,
    behavior: 'aggressive',
    mapId: 'dungeon',
    position: { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE },
    direction: Direction.Down,
    action: CharacterAction.Idle,
    kind: 'npc',
  };
  dungeon.npcs[goblin.id] = goblin;

  sim.map.tiles[1]![2]!.warp = {
    to: 'dungeon',
    position: { x: TILE_SIZE, y: TILE_SIZE },
  };
}

/** Walks a player at (1,1) one tile right, onto the warp. */
function walkIn(name: string): void {
  sim.press(name, Key.ArrowRight);
  sim.step(10);
  sim.release(name, Key.ArrowRight);
}

beforeEach(() => {
  clearInstancesForTest();
  while (unsubscribes.length) unsubscribes.pop()!();
  sim = createFixture();
  buildDungeon();
});

describe('walking into an instanced map', () => {
  it('lands on a copy of it, leaving the map itself empty', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });

    walkIn('Alice');

    const mapId = sim.getPlayer('Alice').mapId;
    expect(isInstanceKey(mapId)).toBe(true);
    // The template is the blueprint, never the room: a player standing on it
    // would be in a dungeon that every other party can walk into.
    expect(Object.keys(runtimeState.maps.dungeon!.players)).toEqual([]);
    expect(runtimeState.maps[mapId]!.players[sim.getPlayer('Alice').id]).toBe(
      sim.getPlayer('Alice'),
    );
  });

  it('gives each player their own copy, and one copy to whoever answers together', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.addPlayer({ name: 'Bob', position: { x: TILE_SIZE, y: TILE_SIZE } });

    walkIn('Alice');
    walkIn('Bob');
    const alone = sim.getPlayer('Alice').mapId;
    expect(sim.getPlayer('Bob').mapId).not.toBe(alone);

    // What a party module does: one name for the group, so it gets one room.
    unsubscribes.push(
      on('instanceOwner', (ctx) => {
        ctx.owner = 'party:Alice';
      }),
    );
    sim.addPlayer({ name: 'Cara', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.addPlayer({ name: 'Dan', position: { x: TILE_SIZE, y: TILE_SIZE } });
    walkIn('Cara');
    walkIn('Dan');

    expect(sim.getPlayer('Dan').mapId).toBe(sim.getPlayer('Cara').mapId);
    expect(sim.getPlayer('Cara').mapId).not.toBe(alone);
  });

  it('gives the copy its own npcs, at full health and under ids of their own', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });

    walkIn('Alice');

    const copy = runtimeState.maps[sim.getPlayer('Alice').mapId]!;
    const npcs = Object.values(copy.npcs);
    expect(npcs).toHaveLength(1);
    // The replication cache is keyed by entity id alone, so two rooms sharing
    // an npc id would inherit each other's diff history.
    expect(npcs[0]!.id).not.toBe('goblin:5:5');
    expect(npcs[0]!.mapId).toBe(copy.id);
    expect(npcs[0]!.health).toBe(30);
    // The one in the template was left exactly as it was.
    expect(runtimeState.maps.dungeon!.npcs['goblin:5:5']!.health).toBe(12);
  });

  it('builds a new copy from the npcs the template has now', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    walkIn('Alice');
    // What a map edit does to the template: the spawn moved to (2,2).
    const template = runtimeState.maps.dungeon!;
    const goblin = template.npcs['goblin:5:5']!;
    delete template.npcs['goblin:5:5'];
    template.npcs['goblin:2:2'] = {
      ...goblin,
      id: 'goblin:2:2',
      position: { x: 2 * TILE_SIZE, y: 2 * TILE_SIZE },
    };

    sim.addPlayer({ name: 'Bob', position: { x: TILE_SIZE, y: TILE_SIZE } });
    walkIn('Bob');

    const copy = runtimeState.maps[sim.getPlayer('Bob').mapId]!;
    expect(Object.values(copy.npcs).map((npc) => npc.position)).toEqual([
      { x: 2 * TILE_SIZE, y: 2 * TILE_SIZE },
    ]);
  });

  it('leaves the template npcs where they stand while copies play', () => {
    const goblin = runtimeState.maps.dungeon!.npcs['goblin:5:5']!;
    goblin.behavior = 'hostile';

    sim.step(200);

    expect(goblin.position).toEqual({ x: 5 * TILE_SIZE, y: 5 * TILE_SIZE });
  });

  it('sends a warp naming a copy into that copy, not a copy of it', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.addPlayer({
      name: 'Bob',
      position: { x: TILE_SIZE, y: 3 * TILE_SIZE },
    });
    walkIn('Alice');
    const room = sim.getPlayer('Alice').mapId;

    // What `tp Bob Alice` resolves to: the map Alice stands on.
    warpToMap(sim.getPlayer('Bob'), room, { x: 2 * TILE_SIZE, y: TILE_SIZE });

    expect(sim.getPlayer('Bob').mapId).toBe(room);
  });

  it('puts a script teleport into a copy as well', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    const api = buildApi(
      'portal.js',
      () => {},
      () => {},
    );

    api.teleportPlayer(sim.getPlayer('Alice'), 'dungeon', 1, 1);

    expect(isInstanceKey(sim.getPlayer('Alice').mapId)).toBe(true);
    expect(Object.keys(runtimeState.maps.dungeon!.players)).toEqual([]);
  });

  it('opens a door in one copy only', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.addPlayer({ name: 'Bob', position: { x: TILE_SIZE, y: TILE_SIZE } });
    walkIn('Alice');
    walkIn('Bob');
    const mine = sim.getPlayer('Alice').mapId;
    const theirs = sim.getPlayer('Bob').mapId;

    expect(setMapTile(mine, 3, 3, { tileIndex: 9, blocked: true })).toBe(true);

    expect(runtimeState.maps[mine]!.tiles[3]![3]).toMatchObject({
      tileIndex: 9,
      blocked: true,
    });
    for (const other of [theirs, 'dungeon']) {
      expect(runtimeState.maps[other]!.tiles[3]![3]!.tileIndex).not.toBe(9);
      expect(runtimeState.maps[other]!.tiles[3]![3]!.blocked).toBeFalsy();
    }
  });

  // A copy lives in memory only: the door it opens is the run's, and there is
  // no map document of the copy for it to be written to.
  it('opens a locked door in the copy without trying to save the copy', async () => {
    const { logger } = await import('../../logger.js');
    const errors = vi.spyOn(logger, 'error');
    runtimeState.maps.dungeon!.tiles[1]![2] = {
      tileIndex: 0,
      blocked: true,
      door: { requiresItem: 77, openTileIndex: 5 },
    };
    sim.addPlayer({
      name: 'Alice',
      position: { x: TILE_SIZE, y: TILE_SIZE },
      inventory: { items: [{ item: 77, quantity: 1 }], maxCapacity: 10 },
    });
    walkIn('Alice');
    const room = sim.getPlayer('Alice').mapId;

    walkIn('Alice');
    await Promise.resolve();

    expect(runtimeState.maps[room]!.tiles[1]![2]).toMatchObject({
      tileIndex: 5,
      blocked: false,
    });
    expect(runtimeState.maps.dungeon!.tiles[1]![2].door).toBeDefined();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('what is written down about a player inside one', () => {
  it('is the doorway, never the key of a room that will not exist', () => {
    const player = sim.addPlayer({
      name: 'Alice',
      position: { x: TILE_SIZE, y: TILE_SIZE },
    });

    walkIn('Alice');

    // The doorway is the warp tile they were standing on, not where they
    // started walking from.
    expect(persistedLocation(player)).toEqual({
      mapId: 'map1',
      position: { x: 2 * TILE_SIZE, y: TILE_SIZE },
    });
  });
});

describe('closing a copy', () => {
  it('waits out the grace before closing an empty one, and keeps it for whoever comes back', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    walkIn('Alice');
    const room = sim.getPlayer('Alice').mapId;

    // Out again: the room is empty from here on.
    delete runtimeState.maps[room]!.players[sim.getPlayer('Alice').id];
    sim.getPlayer('Alice').mapId = 'map1';
    sim.getPlayer('Alice').position = { x: TILE_SIZE, y: TILE_SIZE };

    sweepInstances();
    sim.step(10);
    sweepInstances();
    expect(runtimeState.maps[room]).toBeDefined();

    // Back through the same door inside the grace: the same room, which is
    // what makes a dropped connection survivable.
    walkIn('Alice');
    expect(sim.getPlayer('Alice').mapId).toBe(room);
  });

  it('closes it once the grace has passed', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    walkIn('Alice');
    const room = sim.getPlayer('Alice').mapId;

    delete runtimeState.maps[room]!.players[sim.getPlayer('Alice').id];
    sim.getPlayer('Alice').mapId = 'map1';
    sweepInstances();
    // 2s of grace at 20 ticks a second, and one tick more.
    sim.step(41);
    sweepInstances();

    expect(runtimeState.maps[room]).toBeUndefined();
  });

  it('takes its npcs out of the world with it', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    walkIn('Alice');
    const room = sim.getPlayer('Alice').mapId;
    const inside = Object.values(runtimeState.maps[room]!.npcs);
    const removed: RuntimeNpc[] = [];
    unsubscribes.push(on('npcRemoved', ({ npc }) => void removed.push(npc)));

    delete runtimeState.maps[room]!.players[sim.getPlayer('Alice').id];
    sim.getPlayer('Alice').mapId = 'map1';
    sweepInstances();
    sim.step(41);
    sweepInstances();

    expect(inside).toHaveLength(1);
    expect(removed).toEqual(inside);
  });
});
