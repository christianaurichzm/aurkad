// Loot tables, cached: a table is read on every NPC death, inside the tick,
// the same reason `items` is a module-level Map in itemService.ts.

import LootTableModel from '../../model/LootTable.js';
import { contentCache } from '../../persistence/contentCache.js';
import type { LootTable, NpcItemDrop } from '../../../shared/types.js';

const tables = contentCache<LootTable>(LootTableModel);

/**
 * The table an npc's own drop list becomes, exactly: `guaranteed` entries
 * each roll an independent chance and stack when repeated, as the list
 * does. The weighted `entries` stay empty, as a conversion should not
 * invent a rarity nobody authored.
 */
export function dropsToLootTable(
  npcId: string,
  npcName: string,
  drops: NpcItemDrop[],
): LootTable {
  return {
    id: `npc-${npcId}-drops`,
    name: `${npcName} drops`,
    guaranteed: drops.map((drop) => ({
      itemId: drop.itemId,
      chance: drop.chance,
      ...(drop.quantity !== undefined ? { quantity: drop.quantity } : {}),
    })),
    entries: [],
  };
}

export const getLootTable = tables.get;
export const cachedLootTables = tables.all;
export const loadLootTables = tables.load;
export const listLootTables = tables.list;
export const createOrUpdateLootTable = tables.upsert;
export const deleteLootTable = tables.remove;
export const clearLootTableCache = tables.clear;
