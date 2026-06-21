import { describe, it, expect, beforeEach } from 'vitest';
import { Direction, Key } from '../../shared/types.js';
import { TILE_SIZE } from '../../shared/constants.js';
import { createFixture } from './simFixture.js';

let sim: ReturnType<typeof createFixture>;

beforeEach(() => {
  sim = createFixture(42);
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
      itemsToDrop: [{ itemId: 1, chance: 100 }],
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
      itemsToDrop: [{ itemId: 1, chance: 100, quantity: 5 }],
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
