import {
  GameState,
  Item,
  Key,
  MapStateServer,
  PlayerServer,
  PlayersServerMap,
  Tile,
} from '../shared/types.js';

import { createOrUpdateMap } from './services/mapService.js';
import { deleteNpc } from './services/npcService.js';

import {
  createOrUpdatePlayer,
  deletePlayer,
} from './services/playerService.js';

export const players: PlayersServerMap = {};

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

export const runtimeState: GameState = {
  maps: {},
};

export const getRuntimeState = (): GameState => runtimeState;

export const getMap = (mapId?: string): MapStateServer | undefined => {
  if (!mapId) return;
  return runtimeState.maps[mapId];
};

export const updateMap = (map: MapStateServer): MapStateServer | undefined => {
  if (!runtimeState.maps[map.id]) {
    console.warn('updateMap: Map not found', map.id);
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
    console.warn('updateMap: Map not found', mapState.id);
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
  players[player.id] = player;

  const map = getMap(player.mapId);
  if (map) {
    map.players[player.id] = player;
  } else {
    console.warn('addPlayer: Map not found', player.mapId);
  }

  await createOrUpdatePlayer(player);
};

export const getPlayer = (playerId: string): PlayerServer | undefined => {
  const player = players[playerId];
  if (!player) console.warn('getPlayer: Player not found', playerId);
  return player;
};

export const removePlayer = async (playerId: string): Promise<void> => {
  delete players[playerId];
  for (const map of Object.values(runtimeState.maps)) {
    delete map.players[playerId];
  }
  await deletePlayer(playerId);
};

export const updatePlayer = async (player: PlayerServer): Promise<void> => {
  players[player.id] = player;

  const map = getMap(player.mapId);
  if (map) {
    map.players[player.id] = player;
  } else {
    console.warn('updatePlayer: Map not found', player.mapId);
  }

  await createOrUpdatePlayer(player);
};

export async function deleteNpcEverywhere(id: string): Promise<void> {
  for (const map of Object.values(runtimeState.maps)) {
    delete map.npcs[id];
  }
  await deleteNpc(id);
}
