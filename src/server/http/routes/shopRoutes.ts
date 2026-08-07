import { type Request, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import { logger } from '../../logger.js';
import {
  parseBody,
  CreateShopBodySchema,
  BuyShopItemBodySchema,
} from '../bodySchemas.js';
import checkAccess from '../middleware/checkAccess.js';
import { validateContentReferences } from '../../services/content/contentValidation.js';
import {
  buyShopItem,
  getShopById,
  listShops,
  createOrUpdateShop,
  deleteShop,
} from '../../services/economy/shopService.js';
import {
  getItemById,
  listItems,
} from '../../services/economy/inventoryService.js';
import {
  enrichPlayer,
  getPlayerByName,
} from '../../services/player/playerService.js';
import { createRouter } from '../../app.js';

// Both sides of a shop: the admin editing one and the player buying from
// it, one domain (`shopService`) with one rule: what the editor puts on a
// shelf, the buy route has to be able to price.
export function createShopRouter() {
  const router = createRouter();

  router.get(
    '/shops',
    checkAccess(Access.ADMIN),
    async (_: Request, res: Response) => {
      try {
        const shops = await listShops();
        res.status(200).json(shops);
      } catch (error) {
        res.status(500).json({ error: 'Could not fetch items' });
      }
    },
  );

  router.get('/shop/:shopId', async (req: Request, res: Response) => {
    try {
      const shopId = req.params['shopId']!;
      const shop = await getShopById(shopId);

      if (!shop) {
        return res.status(404).json({ error: 'Shop not found' });
      }

      const products = shop.products.map((entry) => {
        const item = getItemById(entry.itemId);
        const currency = getItemById(entry.currency);

        if (!item) {
          throw new Error(`Item ${entry.itemId} not found`);
        }
        if (!currency) {
          throw new Error(`Currency ${entry.currency} not found`);
        }

        return {
          item: {
            id: item.id,
            name: item.name,
            sprite: item.sprite,
            description: item.description,
            type: item.type,
          },
          currency: {
            id: currency.id,
            name: currency.name,
            sprite: currency.sprite,
            description: currency.description,
            type: currency.type,
          },
          price: entry.price,
        };
      });

      res.json({
        id: shop.id,
        name: shop.name,
        products,
      });
    } catch (e) {
      logger.error('Error in route /shop/:shopId', { err: e });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/shops', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateShopBodySchema, req.body, res);
    if (!body) return;
    try {
      const { warnings } = validateContentReferences({
        items: await listItems(),
        shops: [body],
      });
      await createOrUpdateShop(body);
      res.status(201).json({ ...body, warnings });
    } catch {
      res.status(500).json({ error: 'Failed to create shop.' });
    }
  });

  router.put('/shops/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = req.params['id']!;
    const body = parseBody(CreateShopBodySchema, req.body, res);
    if (!body) return;
    try {
      const { warnings } = validateContentReferences({
        items: await listItems(),
        shops: [{ ...body, id }],
      });
      await createOrUpdateShop({ ...body, id });
      res.status(200).json({ success: true, warnings });
    } catch {
      res.status(500).json({ error: 'Failed to update shop.' });
    }
  });

  router.delete('/shops/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = req.params['id']!;
    try {
      await deleteShop(id);
      res.status(204).send();
    } catch {
      res.status(500).json({ error: 'Failed to delete shop.' });
    }
  });

  router.post('/shop/buy', checkAccess(Access.USER), async (req, res) => {
    const body = parseBody(BuyShopItemBodySchema, req.body, res);
    if (!body) return;
    const { shopId, itemId } = body;
    const username = (req as ExtendedRequest).session.username;

    if (!username) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    const player = getPlayerByName(username);
    const shop = await getShopById(shopId);

    if (!player || !shop) {
      return res.status(404).json({ error: 'Shop or player not found' });
    }

    const success = await buyShopItem(player, itemId, shop);

    if (success) {
      const enrichedPlayer = enrichPlayer(player);
      return res.status(200).json({
        success: true,
        message: 'Purchase completed successfully!',
        inventory: enrichedPlayer.inventory,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Purchase failed: insufficient coins/item',
      });
    }
  });

  return router;
}
