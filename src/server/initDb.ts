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
import { sweepUnclaimableDeliveries } from './services/economy/deliveryService.js';
import { loadLootTables } from './services/economy/lootTableService.js';
import { loadLiveOpsFlags } from './services/liveOpsService.js';
import { loadArrows } from './services/content/arrowService.js';
import { loadDialogs } from './services/content/dialogService.js';
import { loadQuests } from './services/content/questService.js';
import { loadRecipes } from './services/content/recipeService.js';
import { loadSpells } from './services/content/spellService.js';
import { MapStateServer } from '../shared/types.js';
import { config } from './config.js';
import { probeTransactionSupport } from './persistence/transactions.js';
import { checkDatabaseSchemaVersion } from './services/dbService.js';

export async function connectToDatabase() {
  try {
    logger.info('[DB] Connecting...', { db: config.mongoDbName });
    await mongoose.connect(config.mongoUri, { dbName: config.mongoDbName });
    logger.info('[DB] Connected successfully');
    // Asked once, here, because it is a property of the deployment and not of
    // any write: whether two documents can be committed together.
    await probeTransactionSupport();
  } catch (err) {
    logger.error('[DB] Connection failed', { err });
    process.exit(1);
  }
}

export async function loadInitialData() {
  try {
    // First, before any world work: a store this build cannot write without
    // losing data has to stop the boot, not be discovered on the first save.
    await checkDatabaseSchemaVersion();

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
    // Loot tables are read inside the tick on every npc death, so they are
    // cached up front rather than fetched per kill. Dialogs are the same case
    // one interaction earlier, and quests are read from four hooks at once.
    await loadLootTables();
    await loadDialogs();
    await loadQuests();
    await loadRecipes();

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

    // After the catalogue is in memory, because that is what it compares
    // against: it catches rows left owing an item that was removed while this
    // instance was down, or by a restore that never crossed `deleteItem`.
    await sweepUnclaimableDeliveries();

    await loadArrows();
    await loadSpells();
    // Before the tick starts: a flag read by a hook on the first tick has to be
    // the one the operator left running, not the default.
    await loadLiveOpsFlags();
    logger.info('Data successfully loaded from database into memory');
  } catch (error) {
    // Essential world data (maps, items) failed to load: abort the boot, which
    // startServer's handler exits(1), rather than come up with an empty world.
    logger.error('Failed to load initial data', { err: error });
    throw error;
  }
}
