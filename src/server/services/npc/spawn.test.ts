import { describe, it, expect } from 'vitest';
import { spawnNpc, despawnNpc } from './spawn.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { TILE_SIZE } from '../../../shared/constants.js';

describe('spawnNpc', () => {
  it('adds a runtime NPC to the map at the given tile', () => {
    const sim = createFixture(0);
    const npc = spawnNpc({
      mapId: sim.mapId,
      col: 3,
      row: 4,
      name: 'Wolf',
      maxHealth: 20,
    });

    expect(npc).toBeDefined();
    expect(npc!.name).toBe('Wolf');
    expect(npc!.health).toBe(20);
    expect(npc!.position).toEqual(tile(3, 4));
    expect(sim.map.npcs[npc!.id]).toBe(npc);
  });

  it('defaults health to maxHealth and behavior to neutral', () => {
    const sim = createFixture(0);
    const npc = spawnNpc({ mapId: sim.mapId, col: 0, row: 0, maxHealth: 15 })!;
    expect(npc.health).toBe(15);
    expect(npc.behavior).toBe('neutral');
    expect(npc.attackRange).toBe(TILE_SIZE);
  });

  it('returns undefined for an unknown map', () => {
    createFixture(0);
    expect(spawnNpc({ mapId: 'nope', col: 0, row: 0 })).toBeUndefined();
  });

  it('gives each spawn a unique id', () => {
    const sim = createFixture(0);
    const a = spawnNpc({ mapId: sim.mapId, col: 0, row: 0 })!;
    const b = spawnNpc({ mapId: sim.mapId, col: 1, row: 0 })!;
    expect(a.id).not.toBe(b.id);
  });
});

describe('despawnNpc', () => {
  it('removes a spawned NPC from its map', () => {
    const sim = createFixture(0);
    const npc = spawnNpc({ mapId: sim.mapId, col: 2, row: 2 })!;
    expect(sim.map.npcs[npc.id]).toBeDefined();

    despawnNpc(npc);
    expect(sim.map.npcs[npc.id]).toBeUndefined();
  });

  it('is a no-op for an NPC that is not present', () => {
    createFixture(0);
    expect(() => despawnNpc({ id: 'ghost' })).not.toThrow();
  });
});
