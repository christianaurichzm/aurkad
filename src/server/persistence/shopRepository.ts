import ShopModel from '../model/Shop.js';
import type { Shop } from '../../shared/types.js';

export const shopRepository = {
  async findById(id: string): Promise<Shop | null> {
    return ShopModel.findOne({ id }).lean<Shop>().exec();
  },

  async upsert(shop: Shop): Promise<void> {
    await ShopModel.findOneAndUpdate({ id: shop.id }, shop, { upsert: true });
  },

  async delete(id: string): Promise<void> {
    await ShopModel.deleteOne({ id });
  },

  async list(): Promise<Shop[]> {
    return ShopModel.find().lean<Shop[]>().exec();
  },
};
