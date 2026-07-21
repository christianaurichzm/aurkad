import mongoose from 'mongoose';
import { logger } from './logger.js';
import {
  createOrUpdateMap,
  insertNpcs,
  listMaps,
} from './services/world/mapService.js';
import {
  createDefaultTiles,
  items,
  runtimeState,
} from './services/world/gameData.js';
import { listItems } from './services/economy/inventoryService.js';
import { loadArrows } from './services/content/arrowService.js';
import { loadSpells } from './services/content/spellService.js';
import { MapStateServer } from '../shared/types.js';
import { config } from './config.js';

export async function connectToDatabase() {
  try {
    logger.info('[DB] Connecting...');
    await mongoose.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017/game',
    );
    logger.info('[DB] Connected successfully');
  } catch (err) {
    logger.error('[DB] Connection failed', { err });
    process.exit(1);
  }
}

export async function loadInitialData() {
  try {
    const ownedMapIds = config.instance.mapIds;
    let loadedMaps: MapStateServer[] = await listMaps();
    if (ownedMapIds) {
      loadedMaps = loadedMaps.filter((m) => ownedMapIds.includes(m.id));
      logger.info('[DB] Sharded mode: loading owned maps', { ownedMapIds });
    }

    if (loadedMaps.length === 0) {
      await createOrUpdateMap({
        name: 'Default Map',
        type: 'normal',
        tiles: createDefaultTiles(),
      });

      loadedMaps = await listMaps();
      logger.info('[DB] No maps found. Created default map.');
    }

    const loadedItems = await listItems();

    for (const map of loadedMaps) {
      if (!map.id || !map.name || !map.type || !map.tiles?.length) {
        logger.warn('[DB] Skipping map with missing required fields', {
          id: map.id,
          name: map.name,
          type: map.type,
          hasTiles: !!map.tiles?.length,
        });
        continue;
      }

      const runtimeMap = {
        ...map,
        players: {},
        npcs: {},
        droppedItems: [],
      };

      await insertNpcs(runtimeMap, map.id, map.tiles);
      runtimeState.maps[map.id] = runtimeMap;
    }

    for (const item of loadedItems) {
      if (item.id == null || !item.name || !item.type) {
        logger.warn('[DB] Skipping item with missing required fields', {
          id: item.id,
          name: item.name,
          type: item.type,
        });
        continue;
      }
      items.set(item.id, item);
    }

    await loadArrows();
    await loadSpells();
    logger.info('Data successfully loaded from database into memory');
  } catch (error) {
    // Essential world data (maps, items) failed to load: abort the boot, which
    // startServer's handler exits(1), rather than come up with an empty world.
    logger.error('Failed to load initial data', { err: error });
    throw error;
  }
}
