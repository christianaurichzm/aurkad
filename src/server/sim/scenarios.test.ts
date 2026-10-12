import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CharacterAction,
  Direction,
  Key,
  type PlayerServer,
} from '../../shared/types.js';
import { TILE_SIZE } from '../../shared/constants.js';
import { createFixture, makeTiles, tile } from './simFixture.js';
import { teleportPlayer } from '../services/world/movementService.js';
import { spawnNpc } from '../services/npc/spawn.js';
import { provideApi } from '../engine/modules/registry.js';
import {
  clearLootTableCache,
  createOrUpdateLootTable,
} from '../services/content/lootTableService.js';
import * as instanceRegistry from '../persistence/instanceRegistry.js';
import { playerRepository } from '../persistence/playerRepository.js';
import { enterWorld } from '../services/player/playerService.js';
import { getMap, getPlayerByName } from './world.js';
import { gameConfig } from '../gameConfig.js';

// Loot tables are documents; these tests only need them in the cache.
vi.mock('../model/LootTable.js', () => ({
  default: {
    findOneAndUpdate: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(() => ({ lean: () => ({ exec: () => Promise.resolve([]) }) })),
  },
}));

let sim: ReturnType<typeof createFixture>;

beforeEach(async () => {
  sim = createFixture(42);
  clearLootTableCache();
  await createOrUpdateLootTable({
    id: 'always-a-coin',
    name: 'Always a coin',
    guaranteed: [{ itemId: 1, chance: 1 }],
    entries: [],
  });
  await createOrUpdateLootTable({
    id: 'five-coins',
    name: 'Five coins',
    guaranteed: [{ itemId: 1, chance: 1, quantity: 5 }],
    entries: [],
  });
});

// Movement

describe('player movement', () => {
  it('moves one tile right after holding arrow right for a full move cycle', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    const startX = sim.getPlayer('Alice').position.x;

    sim.press('Alice', Key.ArrowRight);
    sim.step(5);
    sim.release('Alice', Key.ArrowRight);
    sim.step(1);

    expect(sim.getPlayer('Alice').position.x).toBeGreaterThan(startX);
  });

  it('does not move onto a blocked tile', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.map.tiles[1]![2]!.blocked = true;

    sim.press('Alice', Key.ArrowRight);
    sim.step(10);
    sim.release('Alice', Key.ArrowRight);

    expect(sim.getPlayer('Alice').position.x).toBe(TILE_SIZE);
  });

  it('two players cannot overlap on the same tile', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.addPlayer({
      name: 'Bob',
      position: { x: 2 * TILE_SIZE, y: TILE_SIZE },
    });

    sim.press('Alice', Key.ArrowRight);
    sim.step(10);

    const alice = sim.getPlayer('Alice');
    const bob = sim.getPlayer('Bob');
    const overlap =
      alice.position.x < bob.position.x + bob.width &&
      alice.position.x + alice.width > bob.position.x &&
      alice.position.y < bob.position.y + bob.height &&
      alice.position.y + alice.height > bob.position.y;

    expect(overlap).toBe(false);
  });
});

describe('a conditionally blocked tile', () => {
  let stop: () => void;
  afterEach(() => stop());

  const gate = (allow: (player: PlayerServer) => boolean) => {
    sim.map.tiles[1]![2]!.blocked = true;
    sim.map.tiles[1]![2]!.conditionalBlock = 'members';
    stop = provideApi('conditionalBlock.members', allow);
  };

  it('lets through the player its predicate says yes to', () => {
    gate((player) => player.name === 'Alice');
    sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    sim.addPlayer({ name: 'Bob', position: tile(3, 1) });

    sim.press('Alice', Key.ArrowRight);
    sim.press('Bob', Key.ArrowLeft);
    sim.step(10);

    expect(sim.getPlayer('Alice').position).toEqual(tile(2, 1));
    expect(sim.getPlayer('Bob').position).toEqual(tile(3, 1));
  });

  it('does not let a second player onto someone standing in it', () => {
    gate(() => true);
    sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    sim.addPlayer({ name: 'Bob', position: tile(3, 1) });

    sim.press('Alice', Key.ArrowRight);
    sim.step(10);
    sim.release('Alice', Key.ArrowRight);
    sim.press('Bob', Key.ArrowLeft);
    sim.step(10);

    expect(sim.getPlayer('Alice').position).toEqual(tile(2, 1));
    expect(sim.getPlayer('Bob').position).toEqual(tile(3, 1));
  });
});

describe('walking to a clicked cell', () => {
  const at = (name: string) => {
    const { x, y } = sim.getPlayer(name).position;
    return [x / TILE_SIZE, y / TILE_SIZE];
  };

  it('goes round a wall to the cell and stops there', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    for (let row = 0; row < 4; row++) sim.map.tiles[row]![3]!.blocked = true;

    sim.moveTo('Alice', 5, 1);
    sim.step(80);

    expect(at('Alice')).toEqual([5, 1]);
    expect(sim.getPlayer('Alice').moving).toBe(false);
  });

  it('gives way to an arrow key', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });

    sim.moveTo('Alice', 8, 1);
    sim.step(6);
    sim.press('Alice', Key.ArrowDown);
    sim.release('Alice', Key.ArrowDown);
    sim.step(40);

    // One step toward the click, perhaps one down; nowhere near column 8.
    expect(at('Alice')[0]).toBeLessThan(4);
  });

  it('walks up to a clicked npc and faces it rather than into it', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.addNpc({
      behavior: 'friendly',
      position: { x: 5 * TILE_SIZE, y: TILE_SIZE },
    });

    sim.moveTo('Alice', 5, 1);
    sim.step(40);

    expect(at('Alice')).toEqual([4, 1]);
    expect(sim.getPlayer('Alice').direction).toBe(Direction.Right);
  });

  it('goes round someone standing on the way, through the other gap', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    // Wall on column 3 with two gaps; an npc blocks the near one, so the path
    // takes the far one.
    for (let row = 0; row < 8; row++) {
      if (row !== 1 && row !== 5) sim.map.tiles[row]![3]!.blocked = true;
    }
    sim.addNpc({
      behavior: 'friendly',
      position: { x: 3 * TILE_SIZE, y: TILE_SIZE },
    });

    sim.moveTo('Alice', 5, 1);
    sim.step(120);

    expect(at('Alice')).toEqual([5, 1]);
  });

  it('turns at once to a click beside the player, so the attack behind it lands', () => {
    sim.addPlayer({
      name: 'Alice',
      position: { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE },
      direction: Direction.Down,
    });
    const npc = sim.addNpc({
      behavior: 'hostile',
      position: { x: 2 * TILE_SIZE, y: 3 * TILE_SIZE },
      health: 30,
      maxHealth: 30,
    });

    sim.moveTo('Alice', 2, 3);
    sim.press('Alice', Key.Control);
    sim.step(1);

    expect(sim.getPlayer('Alice').direction).toBe(Direction.Left);
    expect(npc.health).toBeLessThan(30);
  });

  // Click pathing, like arrow keys, must pass npc-only blockers.
  it('walks through a corridor marked to keep npcs out', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    for (let row = 0; row < 8; row++) {
      if (row === 1) sim.map.tiles[row]![3]!.avoidNpc = true;
      else sim.map.tiles[row]![3]!.blocked = true;
    }

    sim.moveTo('Alice', 5, 1);
    sim.step(80);

    expect(at('Alice')).toEqual([5, 1]);
  });

  it('ignores a cell off the map', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });

    sim.moveTo('Alice', 400, 1);
    sim.step(20);

    expect(at('Alice')).toEqual([1, 1]);
  });
});

// NPC behaviour

describe('npc behaviour', () => {
  it('aggressive npc moves toward the player over time', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    const npc = sim.addNpc({
      behavior: 'aggressive',
      position: { x: 5 * TILE_SIZE, y: TILE_SIZE },
    });
    const startDist = Math.abs(npc.position.x - TILE_SIZE);

    sim.step(20);

    const endDist = Math.abs(npc.position.x - TILE_SIZE);
    expect(endDist).toBeLessThan(startDist);
  });

  it('neutral npc does not chase the player', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    const npc = sim.addNpc({
      behavior: 'neutral',
      position: { x: 3 * TILE_SIZE, y: TILE_SIZE },
    });
    const startX = npc.position.x;

    sim.step(20);

    expect(npc.position.x).toBe(startX);
  });
});

// Combat

describe('combat', () => {
  it('player attack damages npc on the tile directly below', () => {
    // Alice faces down (default); NPC one tile below is in range
    sim.addPlayer({
      name: 'Alice',
      position: { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE },
      direction: Direction.Down,
      attack: 10,
      attackRange: TILE_SIZE,
    });
    const npc = sim.addNpc({
      position: { x: 3 * TILE_SIZE, y: 4 * TILE_SIZE },
      health: 30,
      maxHealth: 30,
    });

    sim.press('Alice', Key.Control);
    sim.step(1);

    expect(npc.health).toBeLessThan(30);
  });

  it('player hits an npc three tiles wide from any tile along its side', () => {
    // Footprint cols 5-7, rows 5-7. Neither attacker is on its corner tile.
    const npc = sim.addNpc({
      position: { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE },
      width: 3 * TILE_SIZE,
      height: 3 * TILE_SIZE,
      health: 100,
      maxHealth: 100,
    });
    sim.addPlayer({
      name: 'Below',
      position: { x: 7 * TILE_SIZE, y: 8 * TILE_SIZE },
      direction: Direction.Up,
    });
    sim.addPlayer({
      name: 'Beside',
      position: { x: 8 * TILE_SIZE, y: 6 * TILE_SIZE },
      direction: Direction.Left,
    });

    sim.press('Below', Key.Control);
    sim.press('Beside', Key.Control);
    sim.step(1);

    expect(npc.health).toBe(80);
  });

  it('an npc three tiles wide turns and hits a player beside its lower row', () => {
    sim.addNpc({
      position: { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE },
      width: 3 * TILE_SIZE,
      height: 3 * TILE_SIZE,
      attack: 7,
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      position: { x: 4 * TILE_SIZE, y: 7 * TILE_SIZE },
    });

    sim.step(40);

    expect(alice.health).toBeLessThan(100);
  });

  it('a swing shows for a quarter second, even with the key still held', () => {
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });

    sim.press('Alice', Key.Control);
    sim.step(1);
    expect(sim.getPlayer('Alice').action).toBe(CharacterAction.Attack);

    sim.step(5);
    expect(sim.getPlayer('Alice').action).toBe(CharacterAction.Idle);

    sim.release('Alice', Key.Control);
    sim.press('Alice', Key.Control);
    sim.step(1);
    expect(sim.getPlayer('Alice').action).toBe(CharacterAction.Attack);
  });

  it('npc dies, drops its item, and respawns at its spawn tile', () => {
    sim.addItem({
      id: 1,
      name: 'Herb',
      description: '',
      sprite: 0,
      type: 'consumable',
    });

    sim.addPlayer({
      name: 'Alice',
      position: { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE },
      direction: Direction.Down,
      attack: 999,
      attackRange: TILE_SIZE,
    });

    // respawnNpc only runs when there is a spawn tile that matches the npc id
    const npcId = 'goblin-1';
    sim.map.tiles[10]![10]!.npcSpawn = npcId;

    const npc = sim.addNpc({
      id: npcId,
      position: { x: 3 * TILE_SIZE, y: 4 * TILE_SIZE },
      health: 1,
      maxHealth: 30,
      lootTableId: 'always-a-coin',
    });
    const killPos = { ...npc.position };

    sim.press('Alice', Key.Control);
    sim.step(1);

    const drop = sim.map.droppedItems.find(
      (d) => d.position.x === killPos.x && d.position.y === killPos.y,
    );
    expect(drop?.itemId).toBe(1);
    expect(drop?.quantity).toBe(1);
    expect(npc.health).toBe(npc.maxHealth);
    expect(npc.position).toEqual({ x: 10 * TILE_SIZE, y: 10 * TILE_SIZE });
  });

  it('an npc three tiles wide drops its loot in the middle of where it stood', () => {
    sim.addItem({
      id: 1,
      name: 'Herb',
      description: '',
      sprite: 0,
      type: 'consumable',
    });
    sim.addPlayer({
      name: 'Alice',
      position: { x: 6 * TILE_SIZE, y: 4 * TILE_SIZE },
      direction: Direction.Down,
      attack: 999,
    });
    sim.addNpc({
      position: { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE },
      width: 3 * TILE_SIZE,
      height: 3 * TILE_SIZE,
      health: 1,
      lootTableId: 'always-a-coin',
    });

    sim.press('Alice', Key.Control);
    sim.step(1);

    expect(sim.map.droppedItems.map((d) => d.position)).toEqual([
      { x: 6 * TILE_SIZE, y: 6 * TILE_SIZE },
    ]);
  });

  it('npc drops the configured quantity of an item', () => {
    sim.addItem({
      id: 1,
      name: 'Gold',
      description: '',
      sprite: 0,
      type: 'consumable',
    });

    sim.addPlayer({
      name: 'Alice',
      position: { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE },
      direction: Direction.Down,
      attack: 999,
      attackRange: TILE_SIZE,
    });

    const npc = sim.addNpc({
      position: { x: 3 * TILE_SIZE, y: 4 * TILE_SIZE },
      health: 1,
      maxHealth: 30,
      lootTableId: 'five-coins',
    });
    const killPos = { ...npc.position };

    sim.press('Alice', Key.Control);
    sim.step(1);

    const drop = sim.map.droppedItems.find(
      (d) => d.position.x === killPos.x && d.position.y === killPos.y,
    );
    expect(drop?.itemId).toBe(1);
    expect(drop?.quantity).toBe(5);
  });

  it('attack cooldown prevents hitting more than once per window', () => {
    sim.addPlayer({
      name: 'Alice',
      position: { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE },
      direction: Direction.Down,
      attack: 10,
      attackRange: TILE_SIZE,
    });
    const npc = sim.addNpc({
      position: { x: 3 * TILE_SIZE, y: 4 * TILE_SIZE },
      health: 100,
      maxHealth: 100,
    });

    sim.press('Alice', Key.Control);
    sim.step(1);
    const healthAfterFirst = npc.health;

    sim.step(1);

    expect(npc.health).toBe(healthAfterFirst);
  });
});

// Items

describe('item pickup', () => {
  it('player picks up item on the same tile', () => {
    sim.addItem({
      id: 5,
      name: 'Potion',
      description: '',
      sprite: 0,
      type: 'consumable',
    });
    sim.addPlayer({
      name: 'Alice',
      position: { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE },
    });
    sim.map.droppedItems.push({
      itemId: 5,
      sprite: 0,
      position: { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE },
      quantity: 1,
    });

    sim.press('Alice', Key.e);
    sim.step(1);

    const alice = sim.getPlayer('Alice');
    expect(alice.inventory.items.some((i) => i.item === 5)).toBe(true);
    expect(sim.map.droppedItems.find((d) => d.itemId === 5)).toBeUndefined();
  });

  it('player ignores item on a different tile', () => {
    sim.addItem({
      id: 6,
      name: 'Herb',
      description: '',
      sprite: 0,
      type: 'consumable',
    });
    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.map.droppedItems.push({
      itemId: 6,
      sprite: 0,
      position: { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE },
      quantity: 1,
    });

    sim.press('Alice', Key.e);
    sim.step(1);

    expect(sim.getPlayer('Alice').inventory.items).toHaveLength(0);
    expect(sim.map.droppedItems.find((d) => d.itemId === 6)).toBeDefined();
  });

  it('takes the item drawn on top of a pile first', () => {
    for (const [id, name] of [
      [7, 'Gold'],
      [8, 'Potion'],
    ] as const) {
      sim.addItem({ id, name, description: '', sprite: 0, type: 'consumable' });
    }
    const at = { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE };
    sim.addPlayer({ name: 'Alice', position: at });
    for (const itemId of [7, 8]) {
      sim.map.droppedItems.push({
        itemId,
        sprite: 0,
        position: at,
        quantity: 1,
      });
    }

    sim.press('Alice', Key.e);
    sim.step(1);

    expect(sim.getPlayer('Alice').inventory.items.map((i) => i.item)).toEqual([
      8,
    ]);
    expect(sim.map.droppedItems.map((d) => d.itemId)).toEqual([7]);
  });
});

// Warps

describe('map warp', () => {
  it('player teleports to the destination map when stepping on a warp tile', () => {
    const dest = sim.addMap({ id: 'map2' });
    sim.map.tiles[1]![2]!.warp = {
      to: dest.id,
      position: { x: TILE_SIZE, y: TILE_SIZE },
    };

    sim.addPlayer({ name: 'Alice', position: { x: TILE_SIZE, y: TILE_SIZE } });
    sim.press('Alice', Key.ArrowRight);
    sim.step(10);

    expect(sim.getPlayer('Alice').mapId).toBe(dest.id);
  });

  // The spatial index is rebuilt once a tick, before anyone moves.
  it('lands two players arriving on one tile in the same tick side by side', () => {
    sim.addMap({ id: 'cave' });
    const alice = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(3, 1) });
    sim.step(1);

    teleportPlayer(alice, 'cave', tile(5, 5));
    teleportPlayer(bob, 'cave', tile(5, 5));

    expect(alice.position).toEqual(tile(5, 5));
    expect(bob.position).not.toEqual(alice.position);
  });

  // A teleported entity stays in its old quadtree node until the rebuild.
  it('lands two players teleported across one map onto one tile side by side', () => {
    for (let col = 0; col < 12; col++)
      sim.addPlayer({ position: tile(col, 0) });
    const alice = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(2, 1) });
    sim.step(1);

    teleportPlayer(alice, sim.mapId, tile(15, 15));
    teleportPlayer(bob, sim.mapId, tile(15, 15));

    expect(alice.position).toEqual(tile(15, 15));
    expect(bob.position).not.toEqual(alice.position);
  });

  it('does not land a player on an npc spawned this tick', () => {
    sim.step(1);

    const npc = spawnNpc({ mapId: sim.mapId, col: 7, row: 7 });
    const alice = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    teleportPlayer(alice, sim.mapId, tile(7, 7));

    expect(npc?.position).toEqual(tile(7, 7));
    expect(alice.position).not.toEqual(tile(7, 7));
  });

  it('does not keep a tile taken by someone who warped off it this tick', () => {
    sim.addMap({ id: 'cave' });
    const alice = sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(1, 1) });
    sim.step(1);

    teleportPlayer(alice, 'cave', tile(2, 2));
    teleportPlayer(bob, sim.mapId, tile(2, 2));

    expect(bob.position).toEqual(tile(2, 2));
  });
});

describe('border links', () => {
  /** Alice steps off the map edge toward `key`. */
  function stepOff(key: Key) {
    sim.press('Alice', key);
    sim.step(1);
    sim.release('Alice', key);
    sim.step(1);
  }

  it.each([
    {
      edge: 'left' as const,
      key: Key.ArrowLeft,
      from: { x: 0, y: 5 * TILE_SIZE },
      expected: { x: 39 * TILE_SIZE, y: 7 * TILE_SIZE },
    },
    {
      edge: 'up' as const,
      key: Key.ArrowUp,
      from: { x: 5 * TILE_SIZE, y: 0 },
      expected: { x: 7 * TILE_SIZE, y: 29 * TILE_SIZE },
    },
    {
      edge: 'right' as const,
      key: Key.ArrowRight,
      from: { x: 19 * TILE_SIZE, y: 5 * TILE_SIZE },
      expected: { x: 0, y: 7 * TILE_SIZE },
    },
    {
      edge: 'down' as const,
      key: Key.ArrowDown,
      from: { x: 5 * TILE_SIZE, y: 19 * TILE_SIZE },
      expected: { x: 7 * TILE_SIZE, y: 0 },
    },
  ])(
    'lands on the $edge neighbour edge when a larger map belongs to another instance',
    async ({ edge, key, from, expected }) => {
      const save = vi.spyOn(playerRepository, 'save').mockResolvedValue(true);
      const lookup = vi
        .spyOn(instanceRegistry, 'lookupInstanceUrl')
        .mockReturnValue('ws://remote');
      try {
        sim.map.borderLinks = { [edge]: { to: 'remote-map', offset: 2 } };
        sim.addPlayer({ name: 'Alice', position: from });
        stepOff(key);
        await vi.waitFor(() =>
          expect(getPlayerByName('Alice')).toBeUndefined(),
        );

        sim.addMap({ id: 'remote-map', tiles: makeTiles(30, 40) });
        const arrival = save.mock.calls[0]![0];
        enterWorld(arrival);

        expect(arrival.position).toEqual(expected);
      } finally {
        save.mockRestore();
        lookup.mockRestore();
      }
    },
  );

  it.each([
    {
      edge: 'left',
      back: 'right',
      key: Key.ArrowLeft,
      returnKey: Key.ArrowRight,
      from: { x: 0, y: 5 * TILE_SIZE },
      expected: { x: 9 * TILE_SIZE, y: 7 * TILE_SIZE },
      offset: 2,
    },
    {
      edge: 'right',
      back: 'left',
      key: Key.ArrowRight,
      returnKey: Key.ArrowLeft,
      from: { x: 19 * TILE_SIZE, y: 5 * TILE_SIZE },
      expected: { x: 0, y: 3 * TILE_SIZE },
      offset: -2,
    },
    {
      edge: 'up',
      back: 'down',
      key: Key.ArrowUp,
      returnKey: Key.ArrowDown,
      from: { x: 5 * TILE_SIZE, y: 0 },
      expected: { x: 3 * TILE_SIZE, y: 29 * TILE_SIZE },
      offset: -2,
    },
    {
      edge: 'down',
      back: 'up',
      key: Key.ArrowDown,
      returnKey: Key.ArrowUp,
      from: { x: 5 * TILE_SIZE, y: 19 * TILE_SIZE },
      expected: { x: 7 * TILE_SIZE, y: 0 },
      offset: 2,
    },
  ])(
    'returns to the same tile through reciprocal $edge links on unequal maps',
    ({ edge, back, key, returnKey, from, expected, offset }) => {
      const dest = sim.addMap({ id: 'neighbour', tiles: makeTiles(30, 10) });
      sim.map.borderLinks = { [edge]: { to: dest.id, offset } };
      dest.borderLinks = { [back]: { to: sim.mapId, offset: -offset } };
      const alice = sim.addPlayer({ name: 'Alice', position: from });

      stepOff(key);

      expect(alice.position).toEqual(expected);
      expect(sim.map.players[alice.id]).toBeUndefined();
      expect(dest.players[alice.id]).toBe(alice);
      expect(alice.moving).toBe(false);
      expect(alice.targetPosition).toBeUndefined();

      stepOff(returnKey);

      expect(alice.mapId).toBe(sim.mapId);
      expect(alice.position).toEqual(from);
      expect(dest.players[alice.id]).toBeUndefined();
      expect(sim.map.players[alice.id]).toBe(alice);
    },
  );

  it.each([
    {
      edge: 'left',
      key: Key.ArrowLeft,
      from: { x: 0, y: 5 * TILE_SIZE },
      offset: -40,
    },
    {
      edge: 'right',
      key: Key.ArrowRight,
      from: { x: 19 * TILE_SIZE, y: 5 * TILE_SIZE },
      offset: 40,
    },
    {
      edge: 'up',
      key: Key.ArrowUp,
      from: { x: 5 * TILE_SIZE, y: 0 },
      offset: -40,
    },
    {
      edge: 'down',
      key: Key.ArrowDown,
      from: { x: 5 * TILE_SIZE, y: 19 * TILE_SIZE },
      offset: 40,
    },
  ])(
    'clamps a $edge crossing with an excessive offset onto a one-tile map',
    ({ edge, key, from, offset }) => {
      const dest = sim.addMap({ id: 'one-tile', tiles: makeTiles(1, 1) });
      sim.map.borderLinks = { [edge]: { to: dest.id, offset } };
      const alice = sim.addPlayer({ name: 'Alice', position: from });

      stepOff(key);

      expect(alice.mapId).toBe(dest.id);
      expect(alice.position).toEqual({ x: 0, y: 0 });
      expect(dest.players[alice.id]).toBe(alice);
    },
  );

  it('lands on the far edge, level with where the player left plus the offset', () => {
    const dest = sim.addMap({ id: 'west', tiles: makeTiles(30, 10) });
    sim.map.borderLinks = { left: { to: dest.id, offset: 2 } };
    sim.addPlayer({ name: 'Alice', position: { x: 0, y: 5 * TILE_SIZE } });

    stepOff(Key.ArrowLeft);

    const alice = sim.getPlayer('Alice');
    expect(alice.mapId).toBe(dest.id);
    expect(alice.position).toEqual({ x: 9 * TILE_SIZE, y: 7 * TILE_SIZE });
  });

  it('pulls a crossing past the end of a shorter map onto it', () => {
    const dest = sim.addMap({ id: 'east', tiles: makeTiles(4, 10) });
    sim.map.borderLinks = { right: { to: dest.id } };
    sim.addPlayer({
      name: 'Alice',
      position: { x: 19 * TILE_SIZE, y: 12 * TILE_SIZE },
    });

    stepOff(Key.ArrowRight);

    const alice = sim.getPlayer('Alice');
    expect(alice.mapId).toBe(dest.id);
    expect(alice.position).toEqual({ x: 0, y: 3 * TILE_SIZE });
  });

  it('still sends the whole edge to a fixed position when the link has one', () => {
    const dest = sim.addMap({ id: 'north' });
    sim.map.borderLinks = {
      up: { to: dest.id, position: { x: 4 * TILE_SIZE, y: 6 * TILE_SIZE } },
    };
    sim.addPlayer({ name: 'Alice', position: { x: 11 * TILE_SIZE, y: 0 } });

    stepOff(Key.ArrowUp);

    expect(sim.getPlayer('Alice').position).toEqual({
      x: 4 * TILE_SIZE,
      y: 6 * TILE_SIZE,
    });
  });
});

// Tile triggers

describe('tile triggers', () => {
  it('heal trigger restores health to max on entry', () => {
    sim.map.tiles[1]![2]!.triggers = [{ action: 'heal' }];
    const player = sim.addPlayer({
      name: 'Alice',
      health: 10,
      maxHealth: 100,
      position: { x: TILE_SIZE, y: TILE_SIZE },
    });

    sim.press('Alice', Key.ArrowRight);
    sim.step(10);

    expect(player.health).toBe(100);
  });

  it('kill trigger resets health to 0 and respawns player', () => {
    sim.map.tiles[1]![2]!.triggers = [{ action: 'kill' }];
    const player = sim.addPlayer({
      name: 'Alice',
      health: 50,
      maxHealth: 100,
      position: { x: TILE_SIZE, y: TILE_SIZE },
    });
    const startPos = { ...player.position };

    sim.press('Alice', Key.ArrowRight);
    sim.step(10);

    // Player is alive (respawned) and moved back to spawn
    expect(player.health).toBeGreaterThan(0);
    expect(player.position).not.toEqual(startPos);
  });

  it('respawns on the start map, off whichever map the player died on', () => {
    sim.addMap({ id: gameConfig.world.startMapId });
    sim.map.tiles[1]![2]!.triggers = [{ action: 'kill' }];
    const player = sim.addPlayer({
      name: 'Alice',
      health: 50,
      maxHealth: 100,
      position: { x: TILE_SIZE, y: TILE_SIZE },
    });

    sim.press('Alice', Key.ArrowRight);
    sim.step(10);

    expect(player.mapId).toBe(gameConfig.world.startMapId);
    expect(player.health).toBe(100);
    expect(getMap(gameConfig.world.startMapId)!.players[player.id]).toBe(
      player,
    );
    expect(sim.map.players[player.id]).toBeUndefined();
  });

  // The start map is on another instance, so respawn hands off like a warp.
  it('hands a dead player to the instance that has the start map', async () => {
    const save = vi.spyOn(playerRepository, 'save').mockResolvedValue(true);
    const lookup = vi
      .spyOn(instanceRegistry, 'lookupInstanceUrl')
      .mockReturnValue('ws://remote');
    try {
      sim.map.tiles[1]![2]!.triggers = [{ action: 'kill' }];
      sim.addPlayer({
        name: 'Alice',
        health: 50,
        maxHealth: 100,
        position: { x: TILE_SIZE, y: TILE_SIZE },
      });

      sim.press('Alice', Key.ArrowRight);
      sim.step(10);
      await vi.waitFor(() => expect(getPlayerByName('Alice')).toBeUndefined());

      expect(lookup).toHaveBeenCalledWith(gameConfig.world.startMapId);
      expect(save.mock.calls.at(-1)![0]).toMatchObject({
        mapId: gameConfig.world.startMapId,
        health: 100,
      });
    } finally {
      save.mockRestore();
      lookup.mockRestore();
    }
  });

  it('multiple triggers all apply on entry', () => {
    sim.map.tiles[1]![2]!.triggers = [
      { action: 'heal' },
      { action: 'message', text: 'Welcome!' },
    ];
    const player = sim.addPlayer({
      name: 'Alice',
      health: 50,
      maxHealth: 100,
      position: { x: TILE_SIZE, y: TILE_SIZE },
    });

    sim.press('Alice', Key.ArrowRight);
    sim.step(10);

    expect(player.health).toBe(100);
  });
});
