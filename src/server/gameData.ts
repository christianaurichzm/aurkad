import {
  GameState,
  Item,
  Key,
  MapStateServer,
  PlayerServer,
  Tile,
} from '../shared/types.js';
import { logger } from './logger.js';

import { createOrUpdateMap } from './services/mapService.js';
import { deleteNpc } from './services/npcService.js';

import { deletePlayer } from './services/playerService.js';
import { runtimeState } from './sim/state.js';
import {
  getPlayerById,
  unregisterPlayer,
  upsertOnCurrentMap,
} from './sim/world.js';
import { markPlayerDirty } from './persistence/dirtyPlayers.js';

export { runtimeState } from './sim/state.js';

export const pressedKeysMap = new Map<string, Set<Key>>();

export const items = new Map<number, Item>();

export function createDefaultTiles(): Tile[][] {
  const rows = 448 / 32;
  const cols = 640 / 32;

  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ tileIndex: -1, blocked: false })),
  );
}

export const defaultTiles = createDefaultTiles();

export const getRuntimeState = (): GameState => runtimeState;

export const getMap = (mapId?: string): MapStateServer | undefined => {
  if (!mapId) return;
  return runtimeState.maps[mapId];
};

export const updateMap = (map: MapStateServer): MapStateServer | undefined => {
  if (!runtimeState.maps[map.id]) {
    logger.warn('updateMap: Map not found', { mapId: map.id });
    return;
  }
  runtimeState.maps[map.id] = map;
  return map;
};

export const updateMapById = async (
  mapState: MapStateServer,
): Promise<MapStateServer | undefined> => {
  const previous = runtimeState.maps[mapState.id];
  if (!previous) {
    logger.warn('updateMap: Map not found', { mapId: mapState.id });
    return;
  }

  mapState.tilesRevision = previous.tilesRevision;
  runtimeState.maps[mapState.id] = mapState;

  await createOrUpdateMap({
    id: mapState.id,
    name: mapState.name,
    type: mapState.type,
    tiles: mapState.tiles,
  });
  return mapState;
};

export const addPlayer = async (player: PlayerServer): Promise<void> => {
  upsertOnCurrentMap(player);
  markPlayerDirty(player.id);
};

export const getPlayer = (playerId: string): PlayerServer | undefined => {
  const player = getPlayerById(playerId);
  if (!player) logger.warn('getPlayer: Player not found', { playerId });
  return player;
};

export const removePlayer = async (playerId: string): Promise<void> => {
  unregisterPlayer(playerId);
  await deletePlayer(playerId);
};

export const updatePlayer = async (player: PlayerServer): Promise<void> => {
  upsertOnCurrentMap(player);
  markPlayerDirty(player.id);
};

export async function deleteNpcEverywhere(id: string): Promise<void> {
  for (const map of Object.values(runtimeState.maps)) {
    delete map.npcs[id];
  }
  await deleteNpc(id);
}
