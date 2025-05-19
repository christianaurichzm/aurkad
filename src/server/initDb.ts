import mongoose from 'mongoose';
import { insertNpcs, listMaps } from './services/mapService';
import { listNpcs } from './services/npcService';
import { listPlayers } from './services/playerService';
import { players, runtimeState, npcs } from './gameData';

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
    const [loadedPlayers, loadedNpcs, loadedMaps] = await Promise.all([
      listPlayers(),
      listNpcs(),
      listMaps(),
    ]);

    for (const player of loadedPlayers) {
      players[player.id] = player;
      const map = runtimeState.maps[player.mapId];
      if (map) map.players[player.id] = player;
    }

    for (const npc of loadedNpcs) {
      npcs[npc.id] = npc;
    }

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
