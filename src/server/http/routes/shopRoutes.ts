import { type Request, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access, type PlayerServer } from '../../../shared/types.js';
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
  shopOpenFor,
} from '../../services/economy/shopService.js';
import { getItemById, listItems } from '../../services/content/itemService.js';
import {
  enrichPlayer,
  getPlayerByName,
} from '../../services/player/playerService.js';
import { createRouter } from '../../app.js';
import { registerStrings, translateFor } from '../../engine/i18n.js';

// What a shopper reads, in the language their page asked in.
registerStrings({
  pt: {
    'You are not at this shop.': 'Você não está nesta loja.',
    'Your bag is full.': 'Sua bolsa está cheia.',
    'You cannot afford that.': 'Você não tem o suficiente para isso.',
    'This shop does not sell that.': 'Esta loja não vende isso.',
  },
});

/**
 * The player behind this session, if they are standing at `shopId`.
 *
 * Answers the response itself so the two routes cannot disagree about what a
 * caller who is not there is told. 403 rather than 404 both times: the shop
 * exists, and pretending otherwise would make "wrong place" and "no such shop"
 * indistinguishable to an operator reading the log.
 */
function atShop(
  req: ExtendedRequest,
  shopId: string,
  res: Response,
): PlayerServer | undefined {
  const username = req.session.username;
  if (!username) {
    res.status(401).json({ error: 'Not logged in' });
    return undefined;
  }

  const player = getPlayerByName(username);
  if (!player || !shopOpenFor(player, shopId)) {
    res
      .status(403)
      .json({ error: translateFor(req, 'You are not at this shop.') });
    return undefined;
  }
  return player;
}

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
      } catch (_error) {
        res.status(500).json({ error: 'Could not fetch items' });
      }
    },
  );

  // Gated like the buy below, or the shelf and prices of every vendor would
  // be readable by anyone who guessed an id, without logging in.
  router.get('/shop/:shopId', async (req, res) => {
    try {
      const shopId = req.params['shopId'];
      if (!atShop(req, shopId, res)) return;

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
            effects: item.effects,
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
    const id = req.params['id'];
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
    const id = req.params['id'];
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

    const player = atShop(req as ExtendedRequest, shopId, res);
    if (!player) return;

    // Reachable through a tile naming a shop that content deleted since.
    const shop = await getShopById(shopId);
    if (!shop) {
      return res.status(404).json({ error: 'Shop or player not found' });
    }

    const bought = await buyShopItem(player, itemId, shop);

    if (bought.ok) {
      const enrichedPlayer = enrichPlayer(player);
      return res.status(200).json({
        success: true,
        message: 'Purchase completed successfully!',
        inventory: enrichedPlayer.inventory,
      });
    }
    // The window greys a row out for a full bag or a short purse before anyone
    // can press it, so these are read only by a client whose bag changed while
    // the shop was open.
    return res.status(400).json({
      success: false,
      reason: bought.reason,
      message: translateFor(
        req,
        bought.reason === 'no-space'
          ? 'Your bag is full.'
          : bought.reason === 'not-enough'
            ? 'You cannot afford that.'
            : 'This shop does not sell that.',
      ),
    });
  });

  return router;
}
