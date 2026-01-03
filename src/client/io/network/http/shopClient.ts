import { httpClient } from './httpClient';

export const buyShopItem = async (
  shopId: string,
  itemId: number,
): Promise<{ success: boolean; message?: string } | null> => {
  return httpClient<{ success: boolean; message?: string }>('/shop/buy', {
    method: 'POST',
    body: { shopId, itemId },
  });
};
