import { TILE_SIZE } from '../../shared/constants.js';
import {
  Tile,
  MapStateServer,
  DroppedItem,
  PlayerServer,
  RuntimeNpc,
  Direction,
  CharacterAction,
} from '../../shared/types.js';
import { getMap, updatePlayer, getPlayer, updateMap } from '../gameData.js';

import GameMapModel from '../model/Map.js';
import { getItemById } from './inventoryService.js';
import { getNpcById } from './npcService.js';

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
  partialMap.droppedItems = droppedItems;
};

export const insertNpcs = (
  partialMap: Partial<MapStateServer>,
  mapId: string,
  tiles: Tile[][],
) => {
  const npcs: Record<string, RuntimeNpc> = {};

  tiles.forEach((row, rowIndex) =>
    row.forEach(async (tile, colIndex) => {
      if (tile.npcSpawn) {
        const base = await getNpcById(tile.npcSpawn);
        if (!base) return;

        const runtimeNpc: RuntimeNpc = {
          ...base,
          health: base.maxHealth,
          position: {
            x: colIndex * TILE_SIZE,
            y: rowIndex * TILE_SIZE,
          },
          mapId,
          direction: Direction.Down,
          action: CharacterAction.Idle,
          kind: 'npc',
        };

        npcs[runtimeNpc.id] = runtimeNpc;
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
