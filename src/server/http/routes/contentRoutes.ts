import { Router, type Request, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access, type PersistentNpc } from '../../../shared/types.js';
import {
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  TILE_SIZE,
} from '../../../shared/constants.js';
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
      const { mapId, tiles, name, type } = req.body ?? {};
      try {
        await mapSave(mapId, tiles, name, type);
        res.status(200).send('Success');
      } catch (e) {
        console.error('mapSave failed:', e);
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
      const { mapId } = req.params;
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
      console.error('Error in route /maps/:mapId:', e);
      res.status(500).json({
        error: 'Internal server error',
        details: String(e),
      });
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
      const { shopId } = req.params;
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
      console.error('Error in route /shop/:shopId:', e);
      res.status(500).json({
        error: 'Internal server error',
        details: String(e),
      });
    }
  });

  router.post('/npcs', checkAccess(Access.ADMIN), async (req, res) => {
    const {
      name,
      sprite,
      maxHealth,
      attack,
      behavior,
      experienceValue,
      itemsToDrop,
    }: PersistentNpc = req.body;

    const defaults = {
      width: SPRITE_WIDTH,
      height: SPRITE_HEIGHT,
      attackRange: TILE_SIZE,
    };

    const npcData = {
      ...defaults,
      name,
      sprite,
      maxHealth,
      attack,
      behavior,
      experienceValue,
      itemsToDrop,
    };

    await createOrUpdateNpc(npcData);
    res.status(201).json(npcData);
  });

  router.post(
    '/players/:id/assignPoints',
    checkAccess(Access.USER),
    async (req: ExtendedRequest, res: Response) => {
      const { vitality = 0, attack = 0 } = req.body ?? {};

      const totalAssigned = vitality + attack;
      if (totalAssigned <= 0) {
        return res.status(400).json({ error: 'No points assigned' });
      }

      const player = await getPlayerById(req.params.id);
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
    const { name, type } = req.body ?? {};

    if (!name || !type) {
      return res.status(400).json({ error: 'Missing map name or type' });
    }

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
      console.error('Error creating map:', error);
      res.status(500).json({ error: 'Failed to create map' });
    }
  });

  router.put('/maps/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const { id } = req.params;
    const { name, type } = req.body ?? {};

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
      console.error('Error updating map:', error);
      res.status(500).json({ error: 'Failed to update map.' });
    }
  });

  router.put('/npcs/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const { id } = req.params;
    const updated = await updateNpcAll(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'NPC not found.' });
    }
    res.status(200).json(updated);
  });
  router.delete('/npcs/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const { id } = req.params;
    await deleteNpcEverywhere(id);
    res.status(204).send();
  });

  router.post('/items', checkAccess(Access.ADMIN), async (req, res) => {
    try {
      const item = req.body;
      if (!item?.name || item.sprite === undefined || !item.type) {
        return res.status(400).json({ error: 'Missing required item fields' });
      }

      await createOrUpdateItem(item);
      res.status(201).json(item);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create item.' });
    }
  });

  router.put('/items/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid item id.' });
    }
    try {
      await createOrUpdateItem({ ...req.body, id });
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
    const { shopId, itemId } = req.body ?? {};
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
