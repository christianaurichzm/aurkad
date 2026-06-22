import PlayerModel from '../model/Player.js';
import { PlayerRecord, PlayerServer } from '../../shared/types.js';
import { gameConfig } from '../gameConfig.js';

// Integrity boundary for player documents leaving the DB. Mongoose minimize
// drops empty objects (e.g. an unequipped player's `equipped: {}`), so loaded
// docs can be missing fields; fill them here so the rest of the app always sees
// a complete record.
export function normalizePlayerRecord(record: PlayerRecord): PlayerRecord {
  return {
    ...record,
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

  async save(player: PlayerServer): Promise<void> {
    await PlayerModel.findOneAndUpdate(
      { id: player.id },
      { $set: player },
      { upsert: false },
    );
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
