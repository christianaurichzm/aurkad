import { TILE_SIZE } from '../../shared/constants';
import {
  Tile,
  MapStateServer,
  DroppedItem,
  NpcsMap,
  PlayerServer,
} from '../../shared/types';
import {
  getMap,
  getNpcs,
  updatePlayer,
  getPlayer,
  updateMap,
} from '../gameData';

import GameMapModel from '../model/Map';
import { getItemById } from './inventoryService';

export async function getMapById(id: string): Promise<MapStateServer | null> {
  return await GameMapModel.findOne({ id }).lean<MapStateServer>().exec();
}

export async function createOrUpdateMap(
  map: Partial<MapStateServer>,
): Promise<void> {
  await GameMapModel.findOneAndUpdate({ id: map.id }, map, { upsert: true });
}

export async function deleteMap(id: string): Promise<void> {
  await GameMapModel.deleteOne({ id });
}

export async function listMaps(): Promise<MapStateServer[]> {
  return await GameMapModel.find().lean<MapStateServer[]>().exec();
}

export const insertModeCell = async (mapId: string, tiles: Tile[][]) => {
  const baseMap = getMap(mapId);

  const partialMap: Partial<typeof baseMap> = {
    tiles,
  };

  await insertNpcs(partialMap, mapId, tiles);
  await insertItems(partialMap, tiles);

  const newMap = {
    ...baseMap,
    ...partialMap,
  };

  return newMap;
};

export const insertItems = async (
  partialMap: Partial<MapStateServer>,
  tiles: Tile[][],
) => {
  const droppedItems: DroppedItem[] = [];

  for (let rowIndex = 0; rowIndex < tiles.length; rowIndex++) {
    const row = tiles[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const tile = row[colIndex];
      if (tile.item) {
        const item = await getItemById(tile.item);
        if (!item) continue;

        droppedItems.push({
          itemId: item.id,
          sprite: item.sprite,
          position: {
            x: colIndex * TILE_SIZE,
            y: rowIndex * TILE_SIZE,
          },
        });
      }
    }
  }
  console.log(droppedItems);
  partialMap.droppedItems = droppedItems;
};

export const insertNpcs = (
  partialMap: Partial<MapStateServer>,
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

export const updatePlayerMap = (playerId: string, newState: PlayerServer) => {
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
