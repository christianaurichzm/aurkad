// Loot tables, cached: a table is read on every NPC death, inside the tick,
// the same reason `items` is a module-level Map in itemService.ts.

import { z } from 'zod';
import LootTableModel from '../../model/LootTable.js';
import { contentCache } from '../../persistence/contentCache.js';
import type { LootTable, NpcItemDrop } from '../../../shared/types.js';

const LootQuantitySchema = z.union([
  z.number().int().positive(),
  z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
]);

const LootEntrySchema = z.object({
  itemId: z.number().int().nonnegative(),
  weight: z.number().nonnegative().optional(),
  chance: z.number().min(0).max(1).optional(),
  quantity: LootQuantitySchema.optional(),
  condition: z.string().min(1).optional(),
});

export const LootTableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  guaranteed: z.array(LootEntrySchema).optional(),
  rolls: z
    .object({
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    })
    .optional(),
  entries: z.array(LootEntrySchema).optional(),
  emptyWeight: z.number().nonnegative().optional(),
});

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
