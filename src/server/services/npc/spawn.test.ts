import { describe, it, expect } from 'vitest';
import { spawnNpc, despawnNpc } from './spawn.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { hasCollision } from '../world/physicsService.js';
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

  // What a script sends is not a form, so every field is checked, not only
  // the map id. Scripts are the owner's own code, so this is no boundary
  // against an attacker; it turns a mistake into an error instead of an npc
  // that cannot be killed or seen.
  it('refuses a tile that is not a number', () => {
    const sim = createFixture(0);

    expect(spawnNpc({ mapId: sim.mapId, col: NaN, row: 3 })).toBeUndefined();
    expect(Object.keys(sim.map.npcs)).toHaveLength(0);
  });

  it('refuses a tile off the map', () => {
    const sim = createFixture(0);

    expect(spawnNpc({ mapId: sim.mapId, col: -1, row: 3 })).toBeUndefined();
    expect(spawnNpc({ mapId: sim.mapId, col: 99999, row: 3 })).toBeUndefined();
    expect(Object.keys(sim.map.npcs)).toHaveLength(0);
  });

  // The one that is not merely wrong-looking: `NaN <= 0` is false, so an npc
  // with NaN health reads as alive in every check the engine makes.
  it('refuses health that is not a positive number', () => {
    const sim = createFixture(0);

    expect(
      spawnNpc({ mapId: sim.mapId, col: 5, row: 5, maxHealth: NaN }),
    ).toBeUndefined();
    expect(
      spawnNpc({ mapId: sim.mapId, col: 5, row: 5, maxHealth: 0 }),
    ).toBeUndefined();
    expect(
      spawnNpc({ mapId: sim.mapId, col: 5, row: 5, maxHealth: -10 }),
    ).toBeUndefined();
  });

  it('never lands inside a wall', () => {
    const sim = createFixture(0);
    sim.map.tiles[3]![3]!.blocked = true;

    const npc = spawnNpc({ mapId: sim.mapId, col: 3, row: 3 })!;

    expect(npc.position).not.toEqual(tile(3, 3));
    expect(hasCollision(npc)).toBe(false);
  });

  it('falls back to defaults for numbers it cannot use', () => {
    const sim = createFixture(0);
    const npc = spawnNpc({
      mapId: sim.mapId,
      col: 5,
      row: 5,
      sprite: NaN,
      attack: -3,
      attackRange: NaN,
    })!;

    expect(npc.sprite).toBe(0);
    expect(npc.attack).toBe(0);
    expect(npc.attackRange).toBe(TILE_SIZE);
  });

  it('takes the tuning a horde needs and ignores what it cannot use', () => {
    const sim = createFixture(0);
    const npc = spawnNpc({
      mapId: sim.mapId,
      col: 5,
      row: 5,
      sight: 30,
      leash: 0,
      experienceValue: 12,
    })!;
    expect(npc).toMatchObject({ sight: 30, leash: 0, experienceValue: 12 });

    const odd = spawnNpc({
      mapId: sim.mapId,
      col: 5,
      row: 5,
      sight: -1,
      leash: NaN,
    })!;
    expect(odd.sight).toBeUndefined();
    expect(odd.leash).toBeUndefined();
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
