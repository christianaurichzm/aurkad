import mongoose from 'mongoose';
import { insertNpcs, listMaps } from './services/mapService';
import { runtimeState } from './gameData';

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
    const loadedMaps = await listMaps();

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

    console.log('Data successfully loaded from database into memory');
  } catch (error) {
    console.error('Failed to load initial data:', error);
  }
}
