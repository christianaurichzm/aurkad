import { type Request, type Response } from 'express';
import { WebSocket } from 'ws';
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
  ResizeMapBodySchema,
  CreateItemBodySchema,
  CreateLootTableBodySchema,
  CreateShopBodySchema,
  BuyShopItemBodySchema,
  AssignPointsBodySchema,
  CreateSpellBodySchema,
  CreateArrowBodySchema,
} from '../bodySchemas.js';
import checkAccess from '../middleware/checkAccess.js';
import {
  createDefaultTiles,
  deleteNpcEverywhere,
  updateMapById,
  updatePlayer,
} from '../../services/world/gameData.js';
import {
  createOrUpdateMap,
  getMapById,
  listMaps,
  mapSave,
} from '../../services/world/mapService.js';
import {
  validateMapTiles,
  resizeTiles,
} from '../../services/world/mapValidation.js';
import {
  validateContentReferences,
  validateScriptReferences,
} from '../../services/content/contentValidation.js';
import {
  describeBehaviors,
  registeredBehaviors,
} from '../../engine/scripting/entityScripts.js';
import {
  buyShopItem,
  getShopById,
  listShops,
  createOrUpdateShop,
  deleteShop,
} from '../../services/economy/shopService.js';
import {
  createOrUpdateItem,
  deleteItem,
  getItemById,
  listItems,
} from '../../services/economy/inventoryService.js';
import {
  createOrUpdateLootTable,
  deleteLootTable,
  listLootTables,
} from '../../services/economy/lootTableService.js';
import {
  enrichPlayer,
  getPlayerById,
  getPlayerByName,
} from '../../services/player/playerService.js';
import {
  createOrUpdateNpc,
  listNpcs,
  updateNpcAll,
} from '../../services/npc/index.js';
import { playersWsMap } from '../../net/connections.js';
import { gameConfig } from '../../gameConfig.js';
import { getNetStats } from '../../net/netStats.js';
import { scheduleContentRefresh } from '../../engine/scripting/contentConstants.js';
import {
  listSpells,
  createOrUpdateSpell,
  deleteSpell,
} from '../../services/content/spellService.js';
import {
  listArrows,
  createOrUpdateArrow,
  deleteArrow,
} from '../../services/content/arrowService.js';
import { createRouter } from '../../app.js';

// Content-definition paths whose mutations should regenerate script constants.
const CONTENT_DEFINITION_PATH =
  /^\/(saveMap|npcs|items|maps|spells|arrows|loot)\b/;

export function createContentRouter() {
  const router = createRouter();

  // After a successful admin edit to content definitions, rebuild the typed
  // constants (Items/Npcs/...) and their .d.ts. Debounced, and scoped so
  // gameplay writes (shop buy, assign points) don't trigger regeneration.
  router.use((req, res, next) => {
    if (
      (req.method === 'POST' ||
        req.method === 'PUT' ||
        req.method === 'DELETE') &&
      CONTENT_DEFINITION_PATH.test(req.path)
    ) {
      res.on('finish', () => {
        if (res.statusCode < 300) scheduleContentRefresh();
      });
    }
    next();
  });

  router.post(
    '/saveMap',
    checkAccess(Access.ADMIN),
    async (req: Request, res: Response) => {
      const body = parseBody(SaveMapBodySchema, req.body, res);
      if (!body) return;
      const { mapId, tiles, name, type, music } = body;
      try {
        const validation = await validateMapTiles(tiles);
        if (validation.errors.length > 0) {
          return res.status(422).json({ errors: validation.errors });
        }
        // A `script` tile naming a behaviour nothing registered would save clean
        // and do nothing in game, so the editor is told at save time.
        const scriptRefs = validateScriptReferences(
          { maps: [{ id: mapId, name, tiles }] },
          registeredBehaviors(),
        );
        await mapSave(mapId, tiles, name, type, music);
        res.status(200).json({
          success: true,
          warnings: [...validation.warnings, ...scriptRefs.warnings],
        });
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
        music: map.music,
        borderLinks: map.borderLinks,
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

  router.post('/npcs', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateNpcBodySchema, req.body, res);
    if (!body) return;

    const npcData = {
      width: SPRITE_WIDTH,
      height: SPRITE_HEIGHT,
      attackRange: TILE_SIZE,
      ...body,
    };

    // Same contract as /saveMap: a dangling drop id is a warning, not a
    // rejection, so the editor can surface it without blocking the save.
    const { warnings } = validateContentReferences({
      items: await listItems(),
      npcs: [npcData],
    });
    warnings.push(
      ...validateScriptReferences({ npcs: [npcData] }, registeredBehaviors())
        .warnings,
    );

    await createOrUpdateNpc(npcData);
    res.status(201).json({ ...npcData, warnings });
  });

  router.get(
    '/players/online',
    checkAccess(Access.USER),
    (_: Request, res: Response) => {
      const players = Array.from(playersWsMap.entries())
        .filter(([, ws]) => ws.readyState === WebSocket.OPEN)
        .map(([username]) => username)
        .sort((a, b) => a.localeCompare(b));

      res.status(200).json({
        players,
        count: players.length,
      });
    },
  );

  router.post(
    '/players/:id/assignPoints',
    checkAccess(Access.USER),
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(AssignPointsBodySchema, req.body, res);
      if (!body) return;
      const { vitality, attack, strength, defense, agility } = body;

      const totalAssigned = vitality + attack + strength + defense + agility;
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
      player.strength += strength;
      player.defense += defense;
      player.agility += agility;
      player.unspentPoints -= totalAssigned;

      player.maxHealth =
        gameConfig.player.startingMaxHealth + player.vitality * 10;

      updatePlayer(player);

      return res.json({
        success: true,
        unspentPoints: player.unspentPoints,
        vitality: player.vitality,
        attack: player.attack,
        strength: player.strength,
        defense: player.defense,
        agility: player.agility,
        maxHealth: player.maxHealth,
      });
    },
  );

  router.post('/maps', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateMapBodySchema, req.body, res);
    if (!body) return;
    const { name, type, cols, rows } = body;

    const defaultMap = {
      players: {},
      npcs: {},
      droppedItems: [],
      tiles: createDefaultTiles(cols, rows),
    };

    const mapData = {
      name,
      type,
    };

    try {
      const mapId = await createOrUpdateMap({ ...defaultMap, ...mapData });
      res.status(201).json({ success: true, mapId });
    } catch (error) {
      logger.error('Error creating map', { err: error });
      res.status(500).json({ error: 'Failed to create map' });
    }
  });

  router.put('/maps/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(UpdateMapBodySchema, req.body, res);
    if (!body) return;
    const id = req.params['id']!;
    const { name, type, music, borderLinks } = body;

    try {
      await createOrUpdateMap({
        id,
        ...(name && { name }),
        ...(type && { type }),
        ...(music !== undefined && { music }),
        ...(borderLinks !== undefined && { borderLinks }),
      });

      res.status(200).json({ message: 'Map updated successfully.' });
    } catch (error) {
      logger.error('Error updating map', { err: error });
      res.status(500).json({ error: 'Failed to update map.' });
    }
  });

  router.post(
    '/maps/:id/resize',
    checkAccess(Access.ADMIN),
    async (req, res) => {
      const body = parseBody(ResizeMapBodySchema, req.body, res);
      if (!body) return;
      const id = req.params['id']!;
      const { cols, rows } = body;
      try {
        const map = await getMapById(id);
        if (!map) return res.status(404).json({ error: 'Map not found.' });
        const resized = resizeTiles(map.tiles, cols, rows);
        await updateMapById({ ...map, tiles: resized });
        res.status(200).json({ success: true, cols, rows });
      } catch (error) {
        logger.error('Error resizing map', { err: error });
        res.status(500).json({ error: 'Failed to resize map.' });
      }
    },
  );

  router.put('/npcs/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateNpcBodySchema, req.body, res);
    if (!body) return;
    const id = req.params['id']!;
    // Editing an existing npc is the common path, so the create route's checks
    // run here too, or a renamed behaviour param would be reported only for
    // npcs created after the rename.
    const { warnings } = validateScriptReferences(
      { npcs: [{ ...body, id }] },
      registeredBehaviors(),
    );
    const updated = await updateNpcAll(id, body);
    if (!updated) {
      return res.status(404).json({ error: 'NPC not found.' });
    }
    res.status(200).json({ ...updated, warnings });
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
      const { warnings } = validateScriptReferences(
        { items: [{ ...body, id: 0 }] },
        registeredBehaviors(),
      );
      await createOrUpdateItem(body);
      res.status(201).json({ ...body, warnings });
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
      const { warnings } = validateScriptReferences(
        { items: [{ ...body, id }] },
        registeredBehaviors(),
      );
      await createOrUpdateItem({ ...body, id });
      res.status(200).json({ success: true, warnings });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update item.' });
    }
  });

  router.get('/loot', checkAccess(Access.ADMIN), async (_req, res) => {
    res.status(200).json(await listLootTables());
  });

  router.post('/loot', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateLootTableBodySchema, req.body, res);
    if (!body) return;
    try {
      // Same contract as the other content editors: a dangling item id is a
      // warning the editor surfaces, not a rejected save.
      const { warnings } = validateContentReferences({
        items: await listItems(),
        lootTables: [body],
      });
      await createOrUpdateLootTable(body);
      res.status(201).json({ ...body, warnings });
    } catch (err) {
      logger.error('createLootTable failed', { err });
      res.status(500).json({ error: 'Failed to save loot table.' });
    }
  });

  router.delete('/loot/:id', checkAccess(Access.ADMIN), async (req, res) => {
    try {
      await deleteLootTable(req.params.id ?? '');
      res.status(204).send();
    } catch (err) {
      logger.error('deleteLootTable failed', { err });
      res.status(500).json({ error: 'Failed to delete loot table.' });
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

  router.get('/debug/net', checkAccess(Access.ADMIN), (_req, res) => {
    res.json(getNetStats());
  });

  // Behaviours currently registered by scripts, with the params each declares,
  // so the content editors can offer them by name and render a field per param
  // instead of asking a designer to remember both. Lives here rather than in
  // scriptsRoutes because that router is only mounted when the script editor is
  // enabled, while behaviours exist whenever scripts do.
  router.get('/behaviors', checkAccess(Access.ADMIN), (_req, res) => {
    res.json(describeBehaviors());
  });

  router.get('/spells', checkAccess(Access.ADMIN), async (_req, res) => {
    try {
      res.json(await listSpells());
    } catch {
      res.status(500).json({ error: 'Could not fetch spells' });
    }
  });

  router.post('/spells', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateSpellBodySchema, req.body, res);
    if (!body) return;
    try {
      const spell = await createOrUpdateSpell(body);
      res.status(201).json(spell);
    } catch {
      res.status(500).json({ error: 'Failed to create spell.' });
    }
  });

  router.put('/spells/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    const body = parseBody(CreateSpellBodySchema, req.body, res);
    if (!body) return;
    try {
      await createOrUpdateSpell({ ...body, id });
      res.status(200).json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to update spell.' });
    }
  });

  router.delete('/spells/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    try {
      await deleteSpell(id);
      res.status(204).send();
    } catch {
      res.status(500).json({ error: 'Failed to delete spell.' });
    }
  });

  router.get('/arrows', checkAccess(Access.ADMIN), async (_req, res) => {
    try {
      res.json(await listArrows());
    } catch {
      res.status(500).json({ error: 'Could not fetch arrows' });
    }
  });

  router.post('/arrows', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateArrowBodySchema, req.body, res);
    if (!body) return;
    try {
      const arrow = await createOrUpdateArrow(body);
      res.status(201).json(arrow);
    } catch {
      res.status(500).json({ error: 'Failed to create arrow.' });
    }
  });

  router.put('/arrows/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    const body = parseBody(CreateArrowBodySchema, req.body, res);
    if (!body) return;
    try {
      await createOrUpdateArrow({ ...body, id });
      res.status(200).json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to update arrow.' });
    }
  });

  router.delete('/arrows/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    try {
      await deleteArrow(id);
      res.status(204).send();
    } catch {
      res.status(500).json({ error: 'Failed to delete arrow.' });
    }
  });

  return router;
}
