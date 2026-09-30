import { shopRepository } from '../../persistence/shopRepository.js';
import { PlayerServer, ProductRaw, Shop } from '../../../shared/types.js';
import { tileAt } from '../../../shared/mapGeometry.js';
import { getMap, updatePlayer } from '../world/gameData.js';
import { persistPlayersNow } from '../player/playerService.js';
import {
  addItem,
  canFit,
  hasItem,
  removeItem,
  type EconomyResult,
} from './economyService.js';

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

/**
 * Whether this player is standing on the tile that opens this shop. A shop
 * id reaches every passer-by with the map chunk, so an id in a request body
 * proves nothing; without this one account could buy from every vendor in
 * the game without walking to any.
 *
 * Derived from the tile, the same rule that opened the shop
 * (`handleWarpAndShops`), so the two cannot drift and walking away closes
 * it with no per-player state to expire.
 */
export function shopOpenFor(player: PlayerServer, shopId: string): boolean {
  const map = getMap(player.mapId);
  return !!map && tileAt(map.tiles, player.position)?.shop === shopId;
}

/** Why a purchase did not happen: the shop's own reason, or the bag's. */
export type PurchaseResult = EconomyResult | { ok: false; reason: 'not-sold' };

export const buyShopItem = async (
  player: PlayerServer,
  itemId: number,
  shop: Shop<ProductRaw>,
): Promise<PurchaseResult> => {
  const product = shop.products.find((p) => p.itemId === itemId);
  if (!product) return { ok: false, reason: 'not-sold' };

  // Both halves are checked before either runs, so the player can never pay
  // for something the inventory then has no room for.
  if (!canFit(player.inventory, itemId)) {
    return { ok: false, reason: 'no-space' };
  }
  if (
    product.price > 0 &&
    !hasItem(player.inventory, product.currency, product.price)
  ) {
    return { ok: false, reason: 'not-enough' };
  }

  if (product.price > 0) {
    removeItem(player.inventory, product.currency, product.price);
  }
  const added = addItem(player.inventory, itemId, 1);
  if (!added.ok) {
    // Unreachable while canFit holds, but refunding beats charging for nothing.
    if (product.price > 0) {
      addItem(player.inventory, product.currency, product.price);
    }
    return added;
  }

  updatePlayer(player);
  await persistPlayersNow([player]);
  return { ok: true };
};
