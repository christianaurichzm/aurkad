import type { ClientSession } from 'mongoose';
import PlayerModel from '../model/Player.js';
import { presenceFence } from './presence.js';
import { Access, PlayerRecord, PlayerServer } from '../../shared/types.js';
import { gameConfig } from '../gameConfig.js';

// Integrity boundary for player documents leaving the DB. Mongoose minimize
// drops empty objects (e.g. an unequipped player's `equipped: {}`), so loaded
// docs can be missing fields; fill them here so the rest of the app always sees
// a complete record.
export function normalizePlayerRecord(record: PlayerRecord): PlayerRecord {
  // The lease and the auth generation are dropped here, not at each caller:
  // neither is about the character, and a runtime copy would be written back
  // by the snapshot loop, reviving a released lease or reverting a bumped
  // generation. Both are read through their own queries.
  const {
    lease: _lease,
    authEpoch: _authEpoch,
    ...rest
  } = record as PlayerRecord & {
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
  async findForAuthentication(name: string): Promise<PlayerRecord | null> {
    const doc = await PlayerModel.findOne({ name }).lean<PlayerRecord>().exec();
    return doc
      ? { ...normalizePlayerRecord(doc), authEpoch: doc.authEpoch ?? 0 }
      : null;
  },
  async findById(id: string): Promise<PlayerRecord | null> {
    const doc = await PlayerModel.findOne({ id }).lean<PlayerRecord>().exec();
    return doc ? normalizePlayerRecord(doc) : null;
  },

  async findByName(name: string): Promise<PlayerRecord | null> {
    const doc = await PlayerModel.findOne({ name }).lean<PlayerRecord>().exec();
    return doc ? normalizePlayerRecord(doc) : null;
  },

  /**
   * The generation a session must match and the level the account acts at,
   * or null when there is no such account, whose sessions are dropped.
   */
  async authOf(
    name: string,
  ): Promise<{ authEpoch: number; access: Access } | null> {
    const doc = await PlayerModel.findOne({ name })
      .select({ authEpoch: 1, access: 1 })
      .lean<{ authEpoch?: number; access?: Access }>()
      .exec();
    return doc
      ? { authEpoch: doc.authEpoch ?? 0, access: doc.access ?? Access.USER }
      : null;
  },

  /** The generation a session must match, or null with no such account. */
  async authEpochOf(name: string): Promise<number | null> {
    return (await playerRepository.authOf(name))?.authEpoch ?? null;
  },

  /** An access level written now, ahead of the snapshot that would carry it. */
  async saveAccess(name: string, access: Access): Promise<void> {
    await PlayerModel.updateOne({ name }, { $set: { access } }).exec();
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

  /**
   * Whether a name is in use ignoring case, so "admin" cannot sign up beside
   * "Admin". Lookups by name stay exact; this is only asked before making one.
   */
  async nameTaken(name: string): Promise<boolean> {
    // The collation of the model's name_ci index, so the query can use it.
    return !!(await PlayerModel.exists({ name }).collation({
      locale: 'en',
      strength: 2,
    }));
  },
};
