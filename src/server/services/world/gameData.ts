import {
  GameState,
  Item,
  MapStateServer,
  PlayerServer,
  Tile,
} from '../../../shared/types.js';
import { logger } from '../../logger.js';

import { createOrUpdateMap } from './mapService.js';
import { deleteNpc } from '../npc/index.js';

import { deletePlayer } from '../player/playerService.js';
import { runtimeState } from '../../sim/state.js';
import {
  getPlayerById,
  unregisterPlayer,
  upsertOnCurrentMap,
} from '../../sim/world.js';
import { markPlayerDirty } from '../../persistence/dirtyPlayers.js';

export { runtimeState } from '../../sim/state.js';

export const items = new Map<number, Item>();

export function createDefaultTiles(cols = 20, rows = 14): Tile[][] {
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

  mapState = { ...previous, ...mapState, players: previous.players };
  mapState.tilesRevision = previous.tilesRevision;
  runtimeState.maps[mapState.id] = mapState;

  await createOrUpdateMap({
    id: mapState.id,
    name: mapState.name,
    type: mapState.type,
    pvp: mapState.pvp,
    orientation: mapState.orientation,
    tiles: mapState.tiles,
    music: mapState.music,
    instanced: mapState.instanced,
    borderLinks: mapState.borderLinks,
  });
  return mapState;
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

// Synchronous: write-behind only marks the player dirty.
export const updatePlayer = (player: PlayerServer): void => {
  upsertOnCurrentMap(player);
  markPlayerDirty(player.id);
};

export async function deleteNpcEverywhere(id: string): Promise<void> {
  for (const map of Object.values(runtimeState.maps)) {
    delete map.npcs[id];
  }
  await deleteNpc(id);
}
