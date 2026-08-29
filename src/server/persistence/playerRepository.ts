import type { ClientSession } from 'mongoose';
import PlayerModel from '../model/Player.js';
import { presenceFence } from './presence.js';
import { PlayerRecord, PlayerServer } from '../../shared/types.js';
import { gameConfig } from '../gameConfig.js';

// Integrity boundary for player documents leaving the DB. Mongoose minimize
// drops empty objects (e.g. an unequipped player's `equipped: {}`), so loaded
// docs can be missing fields; fill them here so the rest of the app always sees
// a complete record.
export function normalizePlayerRecord(record: PlayerRecord): PlayerRecord {
  // The lease is dropped here, not at each caller: it is about which process
  // may write the document, never about the character, and a runtime copy
  // would be written back by the snapshot loop, reviving a released lease on
  // a document nobody owns.
  const { lease: _lease, ...rest } = record as PlayerRecord & {
    lease?: unknown;
  };
  return {
    ...rest,
    strength: record.strength ?? gameConfig.player.startingStrength,
    defense: record.defense ?? gameConfig.player.startingDefense,
    agility: record.agility ?? gameConfig.player.startingAgility,
    equipped: record.equipped ?? {},
    data: record.data ?? {},
    inventory: record.inventory ?? {
      items: [],
      maxCapacity: gameConfig.player.startingInventoryCapacity,
    },
  };
}

export const playerRepository = {
  async findById(id: string): Promise<PlayerRecord | null> {
    const doc = await PlayerModel.findOne({ id }).lean<PlayerRecord>().exec();
    return doc ? normalizePlayerRecord(doc) : null;
  },

  async findByName(name: string): Promise<PlayerRecord | null> {
    const doc = await PlayerModel.findOne({ name }).lean<PlayerRecord>().exec();
    return doc ? normalizePlayerRecord(doc) : null;
  },

  async list(): Promise<PlayerRecord[]> {
    const docs = await PlayerModel.find().lean<PlayerRecord[]>().exec();
    return docs.map(normalizePlayerRecord);
  },

  // `session` is how an economic commit writes both sides of a trade as one
  // document write pair; without it the two writes are independent (see
  // persistence/transactions.ts).
  //
  // Returns whether the document was actually written: with the presence fence
  // in the filter, a write from an instance that no longer owns the account
  // matches nothing, and a silent no-op there is the same lost progress the
  // lease exists to prevent (see persistence/presence.ts).
  async save(player: PlayerServer, session?: ClientSession): Promise<boolean> {
    const written = await PlayerModel.findOneAndUpdate(
      { id: player.id, ...presenceFence(player.id) },
      { $set: player },
      { upsert: false, ...(session ? { session } : {}) },
    );
    return written !== null;
  },

  async insert(record: PlayerRecord): Promise<void> {
    await PlayerModel.create(record);
  },

  async deleteById(id: string): Promise<void> {
    await PlayerModel.deleteOne({ id });
  },

  async anyExists(): Promise<boolean> {
    return !!(await PlayerModel.exists({}));
  },
};
