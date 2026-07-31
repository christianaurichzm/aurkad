import { shopRepository } from '../../persistence/shopRepository.js';
import { PlayerServer, ProductRaw, Shop } from '../../../shared/types.js';
import { updatePlayer } from '../world/gameData.js';
import { persistPlayersNow } from '../player/playerService.js';
import { addItem, canFit, hasItem, removeItem } from './economyService.js';

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

  // Both halves are checked before either runs, so the player can never pay
  // for something the inventory then has no room for.
  if (!canFit(player.inventory, itemId)) return false;
  if (
    product.price > 0 &&
    !hasItem(player.inventory, product.currency, product.price)
  ) {
    return false;
  }

  if (product.price > 0) {
    removeItem(player.inventory, product.currency, product.price);
  }
  if (!addItem(player.inventory, itemId, 1).ok) {
    // Unreachable while canFit holds, but refunding beats charging for nothing.
    if (product.price > 0) {
      addItem(player.inventory, product.currency, product.price);
    }
    return false;
  }

  updatePlayer(player);
  await persistPlayersNow([player]);
  return true;
};
