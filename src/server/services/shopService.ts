import ShopModel from '../model/Shop';
import { Shop } from '../../shared/types';

export async function getShopById(id: string): Promise<Shop | null> {
  return await ShopModel.findOne({ id }).lean<Shop>().exec();
}

export async function createOrUpdateShop(shop: Shop): Promise<void> {
  await ShopModel.findOneAndUpdate({ id: shop.id }, shop, { upsert: true });
}

export async function deleteShop(id: string): Promise<void> {
  await ShopModel.deleteOne({ id });
}

export async function listShops(): Promise<Shop[]> {
  return await ShopModel.find().lean<Shop[]>().exec();
}
