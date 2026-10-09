import type { Model } from 'mongoose';

/**
 * A content collection kept in memory as well as in the database, for
 * content read inside the tick (a dialog on interact, a loot table on a
 * kill, a quest objective, a recipe) where an async round trip will not do.
 * Writes go through here so the next read sees them.
 */
export function contentCache<T extends { id: string }>(model: Model<any>) {
  const byId = new Map<string, T>();

  return {
    get: (id: string): T | undefined => byId.get(id),
    all: (): T[] => [...byId.values()],
    load: async (): Promise<void> => {
      const rows = await model.find().lean<T[]>().exec();
      byId.clear();
      for (const row of rows) byId.set(row.id, row);
    },
    /** Read from the database: another instance may have written since load. */
    list: (): Promise<T[]> => model.find().lean<T[]>().exec(),
    upsert: async (entry: T): Promise<void> => {
      await model.findOneAndUpdate({ id: entry.id }, entry, { upsert: true });
      // A copy, because the caller keeps its reference to the nested lists and
      // the cache is read inside the tick.
      byId.set(entry.id, structuredClone(entry));
    },
    remove: async (id: string): Promise<void> => {
      await model.deleteOne({ id });
      byId.delete(id);
    },
    clear: (): void => byId.clear(),
  };
}
