import { z } from 'zod';
import ShopModel from '../../model/Shop.js';
import { PlayerServer, ProductRaw, Shop } from '../../../shared/types.js';
import { tileAt } from '../../../shared/mapGeometry.js';
import { getMap, updatePlayer } from '../../sim/world.js';
import { persistPlayersNow } from '../player/playerService.js';
import {
  addItem,
  exchangeItems,
  type EconomyResult,
} from './economyService.js';

const ProductSchema = z.object({
  itemId: z.number().int().nonnegative(),
  currency: z.number().int().nonnegative(),
  price: z.number().int().nonnegative(),
});

export const ShopSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  products: z.array(ProductSchema).default([]),
});

export async function getShopById(id: string): Promise<Shop | null> {
  return ShopModel.findOne({ id }).lean<Shop>().exec();
}

export async function createOrUpdateShop(shop: Shop): Promise<void> {
  await ShopModel.findOneAndUpdate({ id: shop.id }, shop, { upsert: true });
}

export async function deleteShop(id: string): Promise<void> {
  await ShopModel.deleteOne({ id });
}

export async function listShops(): Promise<Shop[]> {
  return ShopModel.find().lean<Shop[]>().exec();
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

  // One exchange, so room is judged on the bag the payment leaves: a stack of
  // coins spent in full frees the slot the purchase goes into.
  const result =
    product.price > 0
      ? exchangeItems(
          player.inventory,
          [{ itemId: product.currency, quantity: product.price }],
          { itemId, quantity: 1 },
        )
      : addItem(player.inventory, itemId, 1);
  if (!result.ok) return result;

  updatePlayer(player);
  await persistPlayersNow([player]);
  return { ok: true };
};
