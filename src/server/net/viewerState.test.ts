/**
 * The cold-state change detector that gates `playerStats` sends.
 *
 * The contract these lock down: it never misses a change (a miss means a
 * client stuck on stale stats forever) and it never reports one when nothing
 * moved (a false positive puts the payload back on the per-tick hot path).
 */
import { describe, it, expect } from 'vitest';
import {
  createColdSnapshot,
  updateColdSnapshot,
  type ColdSnapshot,
} from './viewerState.js';
import { toPlayerCold } from './serialization.js';
import { createFixture } from '../sim/simFixture.js';
import type { PlayerServer } from '../../shared/types.js';

// Payload fields compared on their own (inventory, equipped) or that never
// change for a player (id, kind). Everything else toPlayerCold sends is a
// scalar copied off the player.
const NOT_SCALAR = new Set([
  'id',
  'kind',
  'inventory',
  'inventoryCapacity',
  'equipped',
]);

function sentScalars(): (keyof PlayerServer)[] {
  const sim = createFixture(0);
  return Object.keys(toPlayerCold(sim.addPlayer())).filter(
    (key) => !NOT_SCALAR.has(key),
  ) as (keyof PlayerServer)[];
}

function setField(player: PlayerServer, field: string, value: unknown) {
  (player as unknown as Record<string, unknown>)[field] = value;
}

function tracked(overrides: Partial<PlayerServer> = {}): {
  player: PlayerServer;
  snapshot: ColdSnapshot;
} {
  const sim = createFixture(0);
  const player = sim.addPlayer(overrides);
  const snapshot = createColdSnapshot();
  // Prime it: the first call always reports a change.
  updateColdSnapshot(player, snapshot);
  return { player, snapshot };
}

describe('updateColdSnapshot', () => {
  it('reports a change on a fresh snapshot so a new viewer gets a full payload', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer();
    expect(updateColdSnapshot(player, createColdSnapshot())).toBe(true);
  });

  it('reports nothing on an unchanged player', () => {
    const { player, snapshot } = tracked();
    expect(updateColdSnapshot(player, snapshot)).toBe(false);
    expect(updateColdSnapshot(player, snapshot)).toBe(false);
  });

  it('goes quiet again after reporting a change once', () => {
    const { player, snapshot } = tracked();
    player.level = 9;
    expect(updateColdSnapshot(player, snapshot)).toBe(true);
    expect(updateColdSnapshot(player, snapshot)).toBe(false);
  });

  // Every scalar in the payload has to be watched: one that is sent but not
  // compared is a field the client silently stops receiving updates for. Read
  // off toPlayerCold itself, so a field added there is held to this as well.
  const scalars = sentScalars();

  it.each(scalars)('detects a change to %s', (field) => {
    const { player, snapshot } = tracked();
    const was = player[field];
    setField(player, field, typeof was === 'number' ? was + 1 : 'changed');
    expect(updateColdSnapshot(player, snapshot)).toBe(true);
  });

  it('gives every scalar a slot of its own', () => {
    // Values no two fields share: two fields on one slot overwrite each other
    // on every call and never read as unchanged.
    const { player, snapshot } = tracked();
    scalars.forEach((field, i) =>
      setField(
        player,
        field,
        typeof player[field] === 'number' ? 1000 + i : `v${i}`,
      ),
    );
    updateColdSnapshot(player, snapshot);
    expect(updateColdSnapshot(player, snapshot)).toBe(false);
  });

  it('ignores hot fields, which travel in the per-tick self payload', () => {
    const { player, snapshot } = tracked();
    player.health = 3;
    player.position = { x: 512, y: 512 };
    player.moving = true;
    expect(updateColdSnapshot(player, snapshot)).toBe(false);
  });

  describe('inventory', () => {
    it('detects an item added', () => {
      const { player, snapshot } = tracked();
      player.inventory.items.push({ item: 1, quantity: 1 });
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });

    it('detects a quantity change on an item already held', () => {
      const { player, snapshot } = tracked({
        inventory: { items: [{ item: 1, quantity: 1 }], maxCapacity: 10 },
      });
      player.inventory.items[0]!.quantity = 2;
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });

    it('detects an item swapped for a different one at the same slot', () => {
      const { player, snapshot } = tracked({
        inventory: { items: [{ item: 1, quantity: 1 }], maxCapacity: 10 },
      });
      player.inventory.items[0]!.item = 2;
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });

    it('detects an item removed', () => {
      const { player, snapshot } = tracked({
        inventory: {
          items: [
            { item: 1, quantity: 1 },
            { item: 2, quantity: 1 },
          ],
          maxCapacity: 10,
        },
      });
      player.inventory.items.pop();
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });

    // Entries past the current length are left stale; this is the
    // case where that could leak a false negative if the length check were
    // dropped or the tail were compared instead.
    it('detects a regrown inventory whose stale tail happens to match', () => {
      const { player, snapshot } = tracked({
        inventory: {
          items: [
            { item: 1, quantity: 1 },
            { item: 2, quantity: 5 },
          ],
          maxCapacity: 10,
        },
      });
      player.inventory.items.pop();
      expect(updateColdSnapshot(player, snapshot)).toBe(true);

      player.inventory.items.push({ item: 2, quantity: 5 });
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
      expect(updateColdSnapshot(player, snapshot)).toBe(false);
    });

    it('detects a capacity change', () => {
      const { player, snapshot } = tracked();
      player.inventory.maxCapacity = 40;
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });

    it('stays quiet when the item list is rebuilt with identical contents', () => {
      const { player, snapshot } = tracked({
        inventory: { items: [{ item: 1, quantity: 3 }], maxCapacity: 10 },
      });
      player.inventory = { items: [{ item: 1, quantity: 3 }], maxCapacity: 10 };
      expect(updateColdSnapshot(player, snapshot)).toBe(false);
    });
  });

  describe('equipment', () => {
    it('detects an item equipped', () => {
      const { player, snapshot } = tracked();
      player.equipped.weapon = 4;
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });

    it('detects an item unequipped', () => {
      const { player, snapshot } = tracked({ equipped: { weapon: 4 } });
      delete player.equipped.weapon;
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });

    it('detects a swap in a slot', () => {
      const { player, snapshot } = tracked({ equipped: { weapon: 4 } });
      player.equipped.weapon = 5;
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });

    it('watches every slot, not just the first', () => {
      const { player, snapshot } = tracked();
      player.equipped.boots = 9;
      expect(updateColdSnapshot(player, snapshot)).toBe(true);
    });
  });

  it('leaves the snapshot consistent even when the caller ignores the result', () => {
    const { player, snapshot } = tracked();
    player.level = 5;
    player.strength = 20;
    updateColdSnapshot(player, snapshot);
    expect(updateColdSnapshot(player, snapshot)).toBe(false);
  });
});
