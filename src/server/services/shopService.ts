import { shopRepository } from '../persistence/shopRepository.js';
import { PlayerServer, ProductRaw, Shop } from '../../shared/types.js';
import { updatePlayer } from '../gameData.js';
import { persistPlayersNow } from './playerService.js';

export async function getShopById(id: string): Promise<Shop | null> {
  return shopRepository.findById(id);
}

export async function createOrUpdateShop(shop: Shop): Promise<void> {
  await shopRepository.upsert(shop);
}

export async function deleteShop(id: string): Promise<void> {
  await shopRepository.delete(id);
}

export async function listShops(): Promise<Shop[]> {
  return shopRepository.list();
}

export const buyShopItem = async (
  player: PlayerServer,
  itemId: number,
  shop: Shop<ProductRaw>,
): Promise<boolean> => {
  const product = shop.products.find((p) => p.itemId === itemId);
  if (!product) return false;

  const existingItem = player.inventory.items.find((i) => i.item === itemId);
  if (!existingItem) {
    const capacity = player.inventory.maxCapacity ?? Infinity;
    if (player.inventory.items.length >= capacity) return false;
  }

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

  if (existingItem) {
    existingItem.quantity++;
  } else {
    player.inventory.items.push({ item: itemId, quantity: 1 });
  }

  await updatePlayer(player);
  await persistPlayersNow([player]);
  return true;
};
