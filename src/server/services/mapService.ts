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
import { getMap, getPlayer, runtimeState } from '../gameData.js';
import { placePlayerOnMap, detachFromMap } from '../sim/world.js';

import GameMapModel from '../model/Map.js';
import { getNextMapId } from './dbService.js';
import { getItemById } from './inventoryService.js';
import { getNpcById } from './npc/index.js';

export async function getMapById(id: string): Promise<MapStateServer | null> {
  return await GameMapModel.findOne({ id }).lean<MapStateServer>().exec();
}

export async function createOrUpdateMap(
  map: Partial<MapStateServer>,
): Promise<string> {
  if (!map.id) {
    map.id = (await getNextMapId()).toString();
  }

  const previous = runtimeState.maps[map.id];

  const merged = { ...previous, ...map } as MapStateServer;

  const staticChanged =
    map.tiles !== undefined || map.name !== undefined || map.type !== undefined;
  if (staticChanged) {
    merged.tilesRevision = (previous?.tilesRevision ?? 0) + 1;
  }

  runtimeState.maps[map.id] = merged;

  await GameMapModel.findOneAndUpdate({ id: map.id }, map, {
    upsert: true,
    new: true,
  });

  return map.id;
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
    const row = tiles[rowIndex]!;
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const tile = row[colIndex]!;
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
    const row = tiles[rowIndex]!;
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const tile = row[colIndex]!;
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
  _playerId: string,
  newState: PlayerServer,
  previousMapId?: string,
) => {
  placePlayerOnMap(newState, previousMapId);
};

export const addPlayerOnMap = (playerId: string) => {
  const player = getPlayer(playerId);
  if (!player) return;
  return placePlayerOnMap(player);
};

export const removePlayerFromMap = (playerId: string) => {
  return detachFromMap(playerId);
};
