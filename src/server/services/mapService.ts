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
import {
  getMap,
  getPlayer,
  players,
  updateMap,
  runtimeState,
} from '../gameData.js';

import GameMapModel from '../model/Map.js';
import { getNextMapId } from './dbService.js';
import { getItemById } from './inventoryService.js';
import { getNpcById } from './npcService.js';

export async function getMapById(id: string): Promise<MapStateServer | null> {
  return await GameMapModel.findOne({ id }).lean<MapStateServer>().exec();
}

export async function createOrUpdateMap(
  map: Partial<MapStateServer>,
): Promise<void> {
  if (!map.id) {
    map.id = (await getNextMapId()).toString();
  }

  runtimeState.maps[map.id] = {
    ...runtimeState.maps[map.id],
    ...map,
  };

  await GameMapModel.findOneAndUpdate({ id: map.id }, map, {
    upsert: true,
    new: true,
  });
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

export const insertNpcs = async (
  partialMap: Partial<MapStateServer>,
  mapId: string,
  tiles: Tile[][],
) => {
  const npcs: Record<string, RuntimeNpc> = {};

  const npcCache = new Map<string, RuntimeNpc | null>();

  for (let rowIndex = 0; rowIndex < tiles.length; rowIndex++) {
    const row = tiles[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const tile = row[colIndex];
      const npcId = tile.npcSpawn;
      if (!npcId) continue;

      if (!npcCache.has(npcId)) {
        const base = await getNpcById(npcId);
        if (!base) {
          npcCache.set(npcId, null);
        } else {
          npcCache.set(npcId, {
            ...base,
            health: base.maxHealth,
            position: { x: 0, y: 0 },
            mapId,
            direction: Direction.Down,
            action: CharacterAction.Idle,
            kind: 'npc',
          });
        }
      }

      const baseNpc = npcCache.get(npcId);
      if (!baseNpc) continue;

      const runtimeNpc: RuntimeNpc = {
        ...baseNpc,
        position: {
          x: colIndex * TILE_SIZE,
          y: rowIndex * TILE_SIZE,
        },
      };

      npcs[runtimeNpc.id] = runtimeNpc;
    }
  }

  partialMap.npcs = npcs;
};

export const updatePlayerMap = (
  playerId: string,
  newState: PlayerServer,
  previousMapId?: string,
) => {
  const prevMapId = previousMapId ?? getPlayer(playerId)?.mapId;

  if (prevMapId && prevMapId !== newState.mapId) {
    const prevMap = getMap(prevMapId);
    if (prevMap?.players?.[playerId]) {
      delete prevMap.players[playerId];
    }
  }

  players[playerId] = newState;

  const nextMap = getMap(newState.mapId);
  if (!nextMap) return;
  nextMap.players[playerId] = newState;
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
