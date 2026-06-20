import { Router, type Request, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import { logger } from '../../logger.js';
import {
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  TILE_SIZE,
} from '../../../shared/constants.js';
import {
  parseBody,
  SaveMapBodySchema,
  CreateNpcBodySchema,
  CreateMapBodySchema,
  UpdateMapBodySchema,
  CreateItemBodySchema,
  BuyShopItemBodySchema,
  AssignPointsBodySchema,
} from '../bodySchemas.js';
import checkAccess from '../../checkAccess.js';
import {
  createDefaultTiles,
  deleteNpcEverywhere,
  updatePlayer,
} from '../../gameData.js';
import { mapSave } from '../../services/gameService.js';
import {
  createOrUpdateMap,
  getMapById,
  listMaps,
} from '../../services/mapService.js';
import {
  buyShopItem,
  getShopById,
  listShops,
} from '../../services/shopService.js';
import {
  createOrUpdateItem,
  deleteItem,
  getItemById,
  listItems,
} from '../../services/inventoryService.js';
import {
  enrichPlayer,
  getPlayerById,
  getPlayerByName,
} from '../../services/playerService.js';
import {
  createOrUpdateNpc,
  listNpcs,
  updateNpcAll,
} from '../../services/npcService.js';

export function createContentRouter() {
  const router = Router();

  router.post(
    '/saveMap',
    checkAccess(Access.ADMIN),
    async (req: Request, res: Response) => {
      const body = parseBody(SaveMapBodySchema, req.body, res);
      if (!body) return;
      const { mapId, tiles, name, type } = body;
      try {
        await mapSave(mapId, tiles, name, type);
        res.status(200).send('Success');
      } catch (e) {
        logger.error('mapSave failed', { err: e });
        res.status(500).send('Failed to save map');
      }
    },
  );

  router.post(
    '/openMapEditor',
    checkAccess(Access.ADMIN),
    (_: Request, res: Response) => {
      res.status(200).send('Authorized');
    },
  );

  router.post(
    '/openModEditor',
    checkAccess(Access.MOD),
    (_: Request, res: Response) => {
      res.status(200).send('Authorized');
    },
  );

  router.post(
    '/openContentEditor',
    checkAccess(Access.ADMIN),
    (_: Request, res: Response) => {
      res.status(200).send('Authorized');
    },
  );

  router.get(
    '/npcs',
    checkAccess(Access.ADMIN),
    async (_: Request, res: Response) => {
      try {
        const npcs = await listNpcs();
        res.status(200).json(npcs);
      } catch (error) {
        res.status(500).json({ error: 'Could not fetch NPCs' });
      }
    },
  );

  router.get(
    '/items',
    checkAccess(Access.ADMIN),
    async (_: Request, res: Response) => {
      try {
        const items = await listItems();
        res.status(200).json(items);
      } catch (error) {
        res.status(500).json({ error: 'Could not fetch items' });
      }
    },
  );

  router.get(
    '/maps',
    checkAccess(Access.ADMIN),
    async (_: Request, res: Response) => {
      try {
        const items = await listMaps();
        res.status(200).json(items);
      } catch (error) {
        res.status(500).json({ error: 'Could not fetch items' });
      }
    },
  );

  router.get('/maps/:mapId', async (req: Request, res: Response) => {
    try {
      const mapId = req.params['mapId']!;
      const map = await getMapById(mapId);

      if (!map) {
        return res.status(404).json({ error: 'Map not found' });
      }

      res.json({
        id: map.id,
        name: map.name,
        tiles: map.tiles,
        type: map.type,
      });
    } catch (e) {
      logger.error('Error in route /maps/:mapId', { err: e });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

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

      const products = await Promise.all(
        shop.products.map(async (entry) => {
          const item = await getItemById(entry.itemId);
          const currency = await getItemById(entry.currency);

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
        }),
      );

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

  router.post('/npcs', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateNpcBodySchema, req.body, res);
    if (!body) return;

    const npcData = {
      width: SPRITE_WIDTH,
      height: SPRITE_HEIGHT,
      attackRange: TILE_SIZE,
      ...body,
    };

    await createOrUpdateNpc(npcData);
    res.status(201).json(npcData);
  });

  router.post(
    '/players/:id/assignPoints',
    checkAccess(Access.USER),
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(AssignPointsBodySchema, req.body, res);
      if (!body) return;
      const { vitality, attack } = body;

      const totalAssigned = vitality + attack;
      if (totalAssigned === 0) {
        return res.status(400).json({ error: 'No points assigned' });
      }

      const player = await getPlayerById(req.params['id']!);
      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }

      const isSelf = req.session.username === player.name;
      const isAdmin = (req.session.accessLevel ?? Access.USER) >= Access.ADMIN;

      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (totalAssigned > player.unspentPoints) {
        return res.status(400).json({ error: 'Not enough unspent points' });
      }

      player.vitality += vitality;
      player.attack += attack;
      player.unspentPoints -= totalAssigned;

      player.maxHealth = 100 + player.vitality * 10;

      await updatePlayer(player);

      return res.json({
        success: true,
        unspentPoints: player.unspentPoints,
        vitality: player.vitality,
        attack: player.attack,
        maxHealth: player.maxHealth,
      });
    },
  );

  router.post('/maps', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateMapBodySchema, req.body, res);
    if (!body) return;
    const { name, type } = body;

    const defaultMap = {
      players: {},
      npcs: {},
      droppedItems: [],
      tiles: createDefaultTiles(),
    };

    const mapData = {
      name,
      type,
    };

    try {
      await createOrUpdateMap({ ...defaultMap, ...mapData });
      res.status(201).json({ success: true });
    } catch (error) {
      logger.error('Error creating map', { err: error });
      res.status(500).json({ error: 'Failed to create map' });
    }
  });

  router.put('/maps/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(UpdateMapBodySchema, req.body, res);
    if (!body) return;
    const id = req.params['id']!;
    const { name, type } = body;

    try {
      await createOrUpdateMap({
        id,
        ...(name && { name }),
        ...(type && { type }),
      });

      const { broadcast } = await import('../../wsServer.js');
      broadcast();

      res.status(200).json({ message: 'Map updated successfully.' });
    } catch (error) {
      logger.error('Error updating map', { err: error });
      res.status(500).json({ error: 'Failed to update map.' });
    }
  });

  router.put('/npcs/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateNpcBodySchema, req.body, res);
    if (!body) return;
    const id = req.params['id']!;
    const updated = await updateNpcAll(id, body);
    if (!updated) {
      return res.status(404).json({ error: 'NPC not found.' });
    }
    res.status(200).json(updated);
  });
  router.delete('/npcs/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = req.params['id']!;
    await deleteNpcEverywhere(id);
    res.status(204).send();
  });

  router.post('/items', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateItemBodySchema, req.body, res);
    if (!body) return;
    try {
      await createOrUpdateItem(body);
      res.status(201).json(body);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create item.' });
    }
  });

  router.put('/items/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid item id.' });
    }
    const body = parseBody(CreateItemBodySchema, req.body, res);
    if (!body) return;
    try {
      await createOrUpdateItem({ ...body, id });
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update item.' });
    }
  });

  router.delete('/items/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid item id.' });
    }
    try {
      await deleteItem(id);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete item.' });
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
        message: 'Purchase completed successfully!',
        inventory: enrichedPlayer.inventory,
      });
    } else {
      return res.status(400).json({
        error: 'Purchase failed: insufficient coins/item',
      });
    }
  });

  return router;
}
