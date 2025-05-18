import { TILE_SIZE } from '../../shared/constants';
import {
  Tile,
  MapState,
  DroppedItem,
  NpcsMap,
  Player,
} from '../../shared/types';
import {
  getMap,
  getItems,
  getNpcs,
  updatePlayer,
  getPlayer,
  updateMap,
} from '../database';

export const insertModeCell = (mapId: string, tiles: Tile[][]) => {
  const baseMap = getMap(mapId);

  const partialMap: Partial<typeof baseMap> = {
    tiles,
  };

  insertNpcs(partialMap, mapId, tiles);
  insertItems(partialMap, tiles);

  const newMap = {
    ...baseMap,
    ...partialMap,
  };

  return newMap;
};

export const insertItems = (partialMap: Partial<MapState>, tiles: Tile[][]) => {
  const droppedItems: DroppedItem[] = [];

  tiles.forEach((row, rowIndex) =>
    row.forEach((tile, colIndex) => {
      if (tile.item) {
        const { id, sprite } = getItems()[tile.item];
        droppedItems.push({
          itemId: id,
          position: { x: colIndex * TILE_SIZE, y: rowIndex * TILE_SIZE },
          sprite,
        });
      }
    }),
  );

  partialMap.droppedItems = droppedItems;
};

export const insertNpcs = (
  partialMap: Partial<MapState>,
  mapId: string,
  tiles: Tile[][],
) => {
  const npcs: NpcsMap = {};

  tiles.forEach((row, rowIndex) =>
    row.forEach((tile, colIndex) => {
      if (tile.npcSpawn) {
        const npc = {
          ...getNpcs()[tile.npcSpawn],
          position: { x: colIndex * TILE_SIZE, y: rowIndex * TILE_SIZE },
          mapId,
        };
        const npcId = String.fromCharCode(65 + Math.floor(Math.random() * 26));
        npcs[npcId] = npc;
      }
    }),
  );

  partialMap.npcs = npcs;
};

export const updatePlayerMap = (playerId: string, newState: Player) => {
  removePlayerFromMap(playerId);
  updatePlayer(newState);
  addPlayerOnMap(newState.id);
};

export const addPlayerOnMap = (playerId: string) => {
  const player = getPlayer(playerId);
  const map = player && getMap(player.mapId);
  if (!map) return;
  map.players[playerId] = player;
  return updateMap(map);
};

export const removePlayerFromMap = (playerId: string) => {
  const player = getPlayer(playerId);
  const map = player && getMap(player.mapId);
  if (!map) return;
  delete map.players[playerId];
  return updateMap(map);
};
