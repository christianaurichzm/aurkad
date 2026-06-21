import type { InventoryItemDetailed } from '../../../../shared/types';
import { httpClient } from './httpClient';

export interface BuyShopItemResponse {
  success: boolean;
  message?: string;
  inventory?: InventoryItemDetailed[];
}

export const buyShopItem = async (
  shopId: string,
  itemId: number,
): Promise<BuyShopItemResponse | null> => {
  return httpClient<BuyShopItemResponse>('/shop/buy', {
    method: 'POST',
    body: { shopId, itemId },
  });
};
