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
const { runtimeState } = await import('../../sim/state.js');
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
});
