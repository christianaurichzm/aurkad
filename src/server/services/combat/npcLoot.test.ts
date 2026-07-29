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
import { clearAll } from '../../engine/hooks.js';
import { logger } from '../../logger.js';
import type { Item, LootTable } from '../../../shared/types.js';

vi.mock('../../model/LootTable.js', () => ({
  default: {
    findOneAndUpdate: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(() => ({ lean: () => ({ exec: async () => [] }) })),
  },
}));

/** Puts a table in the cache the way an editor save or boot load would. */
async function withTable(table: LootTable): Promise<void> {
  await createOrUpdateLootTable(table);
}

beforeEach(() => {
  clearAll();
  clearLootTableCache();
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

    await resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems).toEqual([
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
      itemsToDrop: [{ itemId: 1, chance: 1 }],
    });

    await resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems.map((d) => d.itemId)).toEqual([2]);
  });

  it('falls back to the legacy list and warns when the table is gone', async () => {
    const { sim, player } = setupWorld();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      lootTableId: 'deleted-table',
      itemsToDrop: [{ itemId: 1, chance: 1 }],
    });

    await resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems.map((d) => d.itemId)).toEqual([1]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('legacy itemsToDrop', () => {
  // The case the chance fix is for: without it this lands ~1% of the time.
  it('drops an entry configured at 100%', async () => {
    const { sim, player } = setupWorld();
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
      itemsToDrop: [{ itemId: 1, chance: 1 }],
    });

    await resolveDamage(npc, 99, { attacker: player, map: sim.map });

    expect(sim.map.droppedItems).toHaveLength(1);
  });

  it('drops nothing when the npc has no loot at all', async () => {
    const { sim, player } = setupWorld();
    const npc = sim.addNpc({
      id: 'g1',
      position: tile(3, 2),
      health: 5,
      maxHealth: 5,
    });

    await resolveDamage(npc, 99, { attacker: player, map: sim.map });

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

    await resolveDamage(npc, 99, { attacker: player, map: sim.map });

    // The good item still drops; only the dangling one is skipped.
    expect(sim.map.droppedItems.map((d) => d.itemId)).toEqual([1]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
