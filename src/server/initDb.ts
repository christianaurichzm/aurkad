import mongoose from 'mongoose';
import {
  createOrUpdateMap,
  insertNpcs,
  listMaps,
} from './services/mapService.js';
import { createDefaultTiles, items, runtimeState } from './gameData.js';
import { listItems } from './services/inventoryService.js';
import { MapStateServer } from '../shared/types.js';

export async function connectToDatabase() {
  try {
    console.log('[DB] Connecting...');
    await mongoose.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017/game',
    );
    console.log('[DB] Connected successfully');
  } catch (err) {
    console.error('[DB] Connection failed:', err);
    process.exit(1);
  }
}

export async function loadInitialData() {
  try {
    let loadedMaps: MapStateServer[] = await listMaps();

    if (loadedMaps.length === 0) {
      await createOrUpdateMap({
        name: 'Default Map',
        type: 'normal',
        tiles: createDefaultTiles(),
      });

      loadedMaps = await listMaps();
      console.log('[DB] No maps found. Created default map.');
    }

    const loadedItems = await listItems();

    for (const map of loadedMaps) {
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
      items.set(item.id, item);
    }

    console.log('Data successfully loaded from database into memory');
  } catch (error) {
    console.error('Failed to load initial data:', error);
  }
}
