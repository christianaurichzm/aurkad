import type { Model } from 'mongoose';
import type { z } from 'zod';
import { unsetAbsent } from '../services/dbService.js';

/**
 * A content collection kept in memory as well as in the database, for
 * content read inside the tick (a dialog on interact, a loot table on a
 * kill, a quest objective, a recipe) where an async round trip will not do.
 * Writes go through here so the next read sees them. `schema` is the
 * entry's shape, whose optional fields an entry leaves out are unset.
 */
export function contentCache<T extends { id: string }>(
  model: Model<any>,
  schema: z.ZodObject<Record<string, z.ZodType>>,
) {
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
      // mongoose casts a `$set` in place, turning the caller's lists into
      // its own arrays, so it is handed a copy.
      await model.findOneAndUpdate(
        { id: entry.id },
        { $set: structuredClone(entry), ...unsetAbsent(schema, entry) },
        { upsert: true },
      );
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
