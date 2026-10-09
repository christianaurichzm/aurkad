import { Router, type Request, type Response } from 'express';
import { Access } from '../../../shared/types.js';
import { logger } from '../../logger.js';
import {
  parseBody,
  SaveMapBodySchema,
  CreateMapBodySchema,
  UpdateMapBodySchema,
  ResizeMapBodySchema,
} from '../bodySchemas.js';
import checkAccess from '../middleware/checkAccess.js';
import {
  createOrUpdateMap,
  getMapById,
  listMaps,
  mapSave,
  createDefaultTiles,
} from '../../services/world/mapService.js';
import {
  validateMapTiles,
  resizeTiles,
} from '../../services/world/mapValidation.js';
import { validateScriptReferences } from '../../services/content/contentValidation.js';
import { registeredBehaviors } from '../../engine/scripting/entityScripts.js';

// The map editor's server side: the tile grid, the map documents and their
// geometry. What the editor names inside a tile (npcs, items, loot) is the
// content catalog, in contentRoutes.
export function createMapRouter() {
  const router = Router();

  router.post('/saveMap', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(SaveMapBodySchema, req.body, res);
    if (!body) return;
    const { mapId, tiles, name, type, music, orientation } = body;
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
      await mapSave(mapId, tiles, name, type, music, orientation);
      res.status(200).json({
        success: true,
        warnings: [...validation.warnings, ...scriptRefs.warnings],
      });
    } catch (e) {
      logger.error('mapSave failed', { err: e });
      res.status(500).send('Failed to save map');
    }
  });

  router.get(
    '/maps',
    checkAccess(Access.ADMIN),
    async (_: Request, res: Response) => {
      try {
        const items = await listMaps();
        res.status(200).json(items);
      } catch (_error) {
        res.status(500).json({ error: 'Could not fetch items' });
      }
    },
  );

  // Admin like every route here that touches a map document. The game gets
  // maps over the socket (mapMeta and chunks), so the map editor is the only
  // caller, and an open route would hand any tile, warp or border link out.
  router.get('/maps/:mapId', checkAccess(Access.ADMIN), async (req, res) => {
    try {
      const mapId = req.params['mapId'];
      const map = await getMapById(mapId);

      if (!map) {
        return res.status(404).json({ error: 'Map not found' });
      }

      res.json({
        id: map.id,
        name: map.name,
        tiles: map.tiles,
        type: map.type,
        orientation: map.orientation,
        music: map.music,
        borderLinks: map.borderLinks,
      });
    } catch (e) {
      logger.error('Error in route /maps/:mapId', { err: e });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/maps', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(CreateMapBodySchema, req.body, res);
    if (!body) return;
    const { name, type, cols, rows, orientation } = body;

    const defaultMap = {
      players: {},
      npcs: {},
      droppedItems: [],
      tiles: createDefaultTiles(cols, rows),
    };

    const mapData = {
      name,
      type,
      orientation,
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
    const id = req.params['id'];
    const { name, type, music, instanced, borderLinks, orientation } = body;

    try {
      await createOrUpdateMap({
        id,
        ...(name && { name }),
        ...(type && { type }),
        ...(orientation && { orientation }),
        ...(music !== undefined && { music }),
        ...(instanced !== undefined && { instanced }),
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
      const id = req.params['id'];
      const { cols, rows } = body;
      try {
        const map = await getMapById(id);
        if (!map) return res.status(404).json({ error: 'Map not found.' });
        const resized = resizeTiles(map.tiles, cols, rows);
        await mapSave(
          id,
          resized,
          map.name,
          map.type,
          map.music,
          map.orientation,
        );
        res.status(200).json({ success: true, cols, rows });
      } catch (error) {
        logger.error('Error resizing map', { err: error });
        res.status(500).json({ error: 'Failed to resize map.' });
      }
    },
  );

  return router;
}
