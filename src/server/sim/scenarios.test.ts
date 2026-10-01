import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Direction, Key } from '../../shared/types.js';
import { TILE_SIZE } from '../../shared/constants.js';
import { createFixture } from './simFixture.js';
import {
  clearLootTableCache,
  createOrUpdateLootTable,
} from '../services/economy/lootTableService.js';

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
