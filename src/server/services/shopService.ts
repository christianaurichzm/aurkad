import ShopModel from '../model/Shop.js';
import { PlayerServer, ProductRaw, Shop } from '../../shared/types.js';
import { updatePlayer } from '../gameData.js';

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

export const buyShopItem = async (
  player: PlayerServer,
  itemId: number,
  shop: Shop<ProductRaw>,
): Promise<boolean> => {
  const product = shop.products.find((p) => p.itemId === itemId);
  if (!product) return false;

  const currencyInInventory = player.inventory.items.find(
    (i) => i.item === product.currency,
  );
  if (!currencyInInventory || currencyInInventory.quantity < product.price)
    return false;

  currencyInInventory.quantity -= product.price;
  if (currencyInInventory.quantity === 0) {
    player.inventory.items = player.inventory.items.filter(
      (i) => i.item !== product.currency,
    );
  }

  const existingItem = player.inventory.items.find((i) => i.item === itemId);
  if (existingItem) {
    existingItem.quantity++;
  } else {
    player.inventory.items.push({ item: itemId, quantity: 1 });
  }

  await updatePlayer(player);
  return true;
};
