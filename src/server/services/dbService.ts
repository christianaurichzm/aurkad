import mongoose from 'mongoose';
import { logger } from '../logger.js';
import type { NpcItemDrop } from '../../shared/types.js';
import {
  createOrUpdateLootTable,
  dropsToLootTable,
} from './content/lootTableService.js';

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 1 },
});

const Counter = mongoose.model('Counter', CounterSchema);

const MetaSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  value: { type: Number, required: true },
});

const Meta = mongoose.model('Meta', MetaSchema);

/**
 * Shape version of the whole store, not of any one collection: what it answers
 * is "was this database written by a build I can run", and a restore replaces
 * every collection at once.
 *
 * Bump it, and write the upgrade step in `checkDatabaseSchemaVersion`, in the
 * same commit as a change that makes an existing document wrong, wherever
 * that document lives.
 */
export const DB_SCHEMA_VERSION = 2;

/**
 * Boot gate for the store, run before anything reads or writes game data.
 * Its job is the refusal: a dump from a newer build restored onto older
 * code reads fine, as Mongoose ignores unknown fields, and the first flush
 * writes it back in the old shape with no error. Only a version tells that
 * from a normal boot.
 *
 * Not a migration framework: an incompatible change bumps the constant and
 * writes its step here, between the refusal and the stamp. One document
 * rather than a marker per row, which only pays once a migration is too big
 * for a single pass.
 */
export async function checkDatabaseSchemaVersion(): Promise<void> {
  const stored = await Meta.findById('schemaVersion').lean<{
    value: number;
  } | null>();

  if (stored && stored.value > DB_SCHEMA_VERSION) {
    throw new Error(
      `Database is at schema version ${stored.value}; this build writes ${DB_SCHEMA_VERSION}. ` +
        'Running it would save documents back in an older shape and drop what it does not know about. ' +
        'Deploy the newer build, or restore a dump that matches this one.',
    );
  }

  if (!stored) {
    // A fresh database, or one stamped by no build yet; both are the current
    // shape, as nothing older was released.
    logger.info('[DB] Stamping schema version', { version: DB_SCHEMA_VERSION });
  }

  // v2: an npc's own drop list becomes a loot table, so there is one way to
  // say what a kill leaves behind instead of two with a precedence rule.
  // dropsToLootTable loses nothing, and on a fresh database this does nothing.
  if (!stored || stored.value < 2) await moveNpcDropsIntoLootTables();

  // Unconditional write of a constant, so every instance of a sharded
  // deployment can run this at its own boot without coordinating.
  await Meta.findByIdAndUpdate(
    'schemaVersion',
    { $set: { value: DB_SCHEMA_VERSION } },
    { upsert: true },
  );
}

/**
 * Turns every npc's `itemsToDrop` into a loot table of its own.
 *
 * Read through the raw collection rather than the model, because the field is
 * gone from the schema by the time this runs and mongoose would hand back
 * documents without the thing being migrated.
 *
 * An npc that already points at a table keeps it: the table always won at kill
 * time, so following the list here would change what it drops.
 */
async function moveNpcDropsIntoLootTables(): Promise<void> {
  const npcs = mongoose.connection.collection('npcs');
  const legacy = await npcs
    .find<{
      id: string;
      name?: string;
      lootTableId?: string;
      itemsToDrop?: NpcItemDrop[];
    }>({ itemsToDrop: { $exists: true, $ne: [] } })
    .toArray();
  if (legacy.length === 0) return;

  let converted = 0;
  for (const npc of legacy) {
    if (!npc.lootTableId && npc.itemsToDrop?.length) {
      const table = dropsToLootTable(
        npc.id,
        npc.name ?? npc.id,
        npc.itemsToDrop,
      );
      await createOrUpdateLootTable(table);
      await npcs.updateOne(
        { id: npc.id },
        { $set: { lootTableId: table.id }, $unset: { itemsToDrop: '' } },
      );
      converted++;
    } else {
      await npcs.updateOne({ id: npc.id }, { $unset: { itemsToDrop: '' } });
    }
  }
  logger.info('[DB] Moved npc drop lists into loot tables', {
    npcs: legacy.length,
    tablesCreated: converted,
  });
}

export async function getNextItemId(): Promise<number> {
  const result = await Counter.findByIdAndUpdate(
    'item',
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );

  return result.seq;
}

export async function getNextNpcId(): Promise<number> {
  const result = await Counter.findByIdAndUpdate(
    'npc',
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );

  return result.seq;
}

export async function getNextMapId(): Promise<number> {
  const result = await Counter.findByIdAndUpdate(
    'map',
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );

  return result.seq;
}

/**
 * Raises a counter above the ids already in a collection. Documents arrive
 * through the counter (editor "create") and through content files or a
 * seed with their own ids, which leave it alone: after a pack with items
 * 1-8, the editor's next item would get id 1 and be upserted over the
 * pack's. Never lowers it, since a gap is harmless and a reused id is not.
 */
export async function raiseCounter(
  name: 'item' | 'npc' | 'map',
  highestId: number,
): Promise<void> {
  if (!Number.isFinite(highestId) || highestId <= 0) return;
  await Counter.findByIdAndUpdate(
    name,
    { $max: { seq: Math.floor(highestId) } },
    { upsert: true },
  );
}
