import GameMapModel from '../model/Map.js';
import type { MapStateServer } from '../../shared/types.js';

export const mapRepository = {
  async findById(id: string): Promise<MapStateServer | null> {
    return GameMapModel.findOne({ id }).lean<MapStateServer>().exec();
  },

  async upsert(id: string, map: Partial<MapStateServer>): Promise<void> {
    await GameMapModel.findOneAndUpdate({ id }, map, {
      upsert: true,
      returnDocument: 'after',
    });
  },

  async delete(id: string): Promise<void> {
    await GameMapModel.deleteOne({ id });
  },

  async list(): Promise<MapStateServer[]> {
    return GameMapModel.find().lean<MapStateServer[]>().exec();
  },
};
