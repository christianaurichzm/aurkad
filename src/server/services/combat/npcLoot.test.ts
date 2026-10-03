/**
 * What hits the ground when an NPC dies. lootService's rolling has its own
 * tests; this covers the wiring in combat: which table is chosen, that
 * legacy drops still work, and that a missing item cannot make a kill throw.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveDamage } from './index.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { items } from '../../services/world/gameData.js';
import { seedRng } from '../../sim/rng.js';
import {
  createOrUpdateLootTable,
  clearLootTableCache,
} from '../economy/lootTableService.js';
import { clearAll, on } from '../../engine/hooks.js';
import { provideApi, clearProvides } from '../../engine/modules/registry.js';
import { despawnNpc } from '../npc/spawn.js';
import {
  clearAllDamageContributions,
  damageContributors,
  damageLedgerSize,
} from './damage.js';
import type { LootConditionContext } from './index.js';
import { logger } from '../../logger.js';
import type {
  DamageContributor,
  Item,
  LootTable,
} from '../../../shared/types.js';

vi.mock('../../model/LootTable.js', () => ({
  default: {
    findOneAndUpdate: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(() => ({ lean: () => ({ exec: () => Promise.resolve([]) }) })),
  },
}));

/** Puts a table in the cache the way an editor save or boot load would. */
async function withTable(table: LootTable): Promise<void> {
  await createOrUpdateLootTable(table);
}

beforeEach(() => {
  clearAll();
  clearProvides();
  clearLootTableCache();
  clearAllDamageContributions();
  seedRng(4242);
});

function setupWorld() {
  const sim = createFixture(0);
  items.set(1, { id: 1, name: 'Coin', sprite: 3, type: 'money' } as Item);
  items.set(2, { id: 2, name: 'Sword', sprite: 4, type: 'weapon' } as Item);
  const player = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
  return { sim, player };
}

describe('loot table on death', () => {
  it('drops what the table rolled, at the npc position', async () => {
    const { sim, player } = setupWorld();
    await withTable({
      id: 'goblin-loot',
      name: 'Goblin',
      guaranteed: [{ itemId: 1, quantity: 5 }],
    });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'goblin-loot',
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems).toMatchObject([
      {
        itemId: 1,
        sprite: 3,
        quantity: 5,
        position: { x: tile(3, 2).x, y: tile(3, 2).y },
      },
    ]);
  });

  it('takes precedence over the legacy list when both are set', async () => {
    const { sim, player } = setupWorld();
    await withTable({
      id: 'table',
      name: 'Table',
      guaranteed: [{ itemId: 2 }],
    });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'table',
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems.map((d) => d.itemId)).toEqual([2]);
  });

  // A deleted table leaves the npc paying nothing, quiet enough to go
  // unnoticed for a week, so it is logged.
  it('drops nothing and warns when the table is gone', () => {
    const { sim, player } = setupWorld();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'deleted-table',
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops nothing when the npc has no loot at all', () => {
    const { sim, player } = setupWorld();
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems).toEqual([]);
  });
});

describe('broken references', () => {
  it('skips an item that no longer exists instead of throwing', async () => {
    const { sim, player } = setupWorld();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await withTable({
      id: 'table',
      name: 'Table',
      guaranteed: [{ itemId: 404 }, { itemId: 1 }],
    });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'table',
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    // The good item still drops; only the dangling one is skipped.
    expect(sim.map.droppedItems.map((d) => d.itemId)).toEqual([1]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('damage contribution', () => {
  it('credits the whole fight, not just the killing blow', () => {
    const { sim, player } = setupWorld();
    const bob = sim.addPlayer({ name: 'Bob', position: tile(2, 3) });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 100,
      maxHealth: 100,
    });

    const seen: DamageContributor[][] = [];
    on('npcDeath', ({ contributors }) => seen.push(contributors));

    // Alice does the work and Bob taps it as it falls. The finishing blow is
    // small, or the killer would top the contributors and nothing would be
    // measured at all.
    resolveDamage(npc, 60, { attacker: player, map: sim.map });
    resolveDamage(npc, 30, { attacker: player, map: sim.map });
    resolveDamage(npc, 20, { attacker: bob, map: sim.map });

    // Sorted by share, so "who earned this" comes first, which here is not the
    // killer: the reason the ledger exists.
    expect(seen[0]?.map((c) => c.playerId)).toEqual([player.id, bob.id]);
    expect(seen[0]?.[0]?.damage).toBeGreaterThan(seen[0]?.[1]?.damage ?? 0);
  });

  it('starts the next fight from zero after a respawn reuses the id', () => {
    const { sim, player } = setupWorld();
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 10,
      maxHealth: 10,
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });
    // respawnNpc keeps the id and restores health, so a ledger left behind
    // would make the next kill report damage from the previous one.
    expect(damageContributors('g1')).toEqual([]);
    expect(damageLedgerSize()).toBe(0);
  });

  it('does not hold a ledger for an npc nothing killed', () => {
    const { sim, player } = setupWorld();
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 100,
      maxHealth: 100,
    });

    resolveDamage(npc, 10, { attacker: player, map: sim.map });
    expect(damageLedgerSize()).toBe(1);

    // A pet or summon that leaves without dying still has to release it.
    despawnNpc({ id: 'g1' });
    expect(damageLedgerSize()).toBe(0);
  });
});

describe('loot conditions', () => {
  it('drops an entry whose condition says no, and keeps the rest', async () => {
    const { sim, player } = setupWorld();
    provideApi('lootCondition.never', () => false);
    await withTable({
      id: 'table',
      name: 'Table',
      guaranteed: [{ itemId: 2, condition: 'never' }, { itemId: 1 }],
    });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'table',
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems.map((d) => d.itemId)).toEqual([1]);
  });

  it('hands the condition the contribution, not just the last hit', async () => {
    const { sim, player } = setupWorld();
    const bob = sim.addPlayer({ name: 'Bob', position: tile(2, 3) });
    let seen: LootConditionContext | undefined;
    provideApi('lootCondition.spy', (ctx: LootConditionContext) => {
      seen = ctx;
      return true;
    });
    await withTable({
      id: 'table',
      name: 'Table',
      guaranteed: [{ itemId: 1, condition: 'spy' }],
    });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 100,
      maxHealth: 100,
      lootTableId: 'table',
    });

    resolveDamage(npc, 40, { attacker: player, map: sim.map });
    resolveDamage(npc, 500, { attacker: bob, map: sim.map });

    expect(seen?.killer?.id).toBe(bob.id);
    expect(seen?.totalDamage).toBeGreaterThan(seen?.contribution ?? 0);
    expect(seen?.contributors).toHaveLength(2);
  });

  it('removes a locked entry from the pool instead of leaving a hole in it', async () => {
    const { sim, player } = setupWorld();
    provideApi('lootCondition.never', () => false);
    await withTable({
      id: 'table',
      name: 'Table',
      // Without filtering first, the locked entry would keep its weight and
      // 99 draws out of 100 would produce nothing at all.
      entries: [
        { itemId: 2, weight: 99, condition: 'never' },
        { itemId: 1, weight: 1 },
      ],
    });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'table',
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems.map((d) => d.itemId)).toEqual([1]);
  });

  it('fails closed when nothing registered the condition', async () => {
    const { sim, player } = setupWorld();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await withTable({
      id: 'table',
      name: 'Table',
      guaranteed: [{ itemId: 1, condition: 'missing' }],
    });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'table',
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    // A script that failed to load must not hand boss loot to everyone.
    expect(sim.map.droppedItems).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('treats a throwing condition as a no', async () => {
    const { sim, player } = setupWorld();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    provideApi('lootCondition.boom', () => {
      throw new Error('script bug');
    });
    await withTable({
      id: 'table',
      name: 'Table',
      guaranteed: [{ itemId: 1, condition: 'boom' }],
    });
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'table',
    });

    resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
