// Loot tables, cached: a table is read on every NPC death, inside the tick,
// the same reason `items` is a module-level Map in world/gameData.ts.

import LootTableModel from '../../model/LootTable.js';
import type { LootTable } from '../../../shared/types.js';

const tables = new Map<string, LootTable>();

export function getLootTable(id: string): LootTable | undefined {
  return tables.get(id);
}

/** Every loaded id, for validating content that references them. */
export function knownLootTableIds(): Set<string> {
  return new Set(tables.keys());
}

export function cachedLootTables(): LootTable[] {
  return [...tables.values()];
}

export async function loadLootTables(): Promise<void> {
  const rows = await LootTableModel.find().lean<LootTable[]>().exec();
  tables.clear();
  for (const row of rows) tables.set(row.id, row);
}

export async function createOrUpdateLootTable(table: LootTable): Promise<void> {
  await LootTableModel.findOneAndUpdate({ id: table.id }, table, {
    upsert: true,
  });
  // Refresh the cache with the same object shape the loader produces, so an
  // edit takes effect on the next kill instead of after a restart.
  tables.set(table.id, { ...table });
}

export async function deleteLootTable(id: string): Promise<void> {
  await LootTableModel.deleteOne({ id });
  tables.delete(id);
}

export async function listLootTables(): Promise<LootTable[]> {
  return LootTableModel.find().lean<LootTable[]>().exec();
}

export function clearLootTableCache(): void {
  tables.clear();
}
