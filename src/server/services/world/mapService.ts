import { TILE_SIZE } from '../../../shared/constants.js';
import {
  Tile,
  MapStateServer,
  DroppedItem,
  PlayerServer,
  RuntimeNpc,
  Direction,
  CharacterAction,
} from '../../../shared/types.js';
import { getMap, getPlayer, runtimeState } from './gameData.js';
import { placePlayerOnMap, detachFromMap } from '../../sim/world.js';

import { mapRepository } from '../../persistence/mapRepository.js';
import { dropQuadtree } from '../../spatial/spatialManager.js';
import { forgetReplicatedEntity } from '../../net/snapshot.js';
import { getNextMapId } from '../dbService.js';
import { getItemById } from '../economy/inventoryService.js';
import { getNpcById } from '../npc/index.js';

export async function getMapById(id: string): Promise<MapStateServer | null> {
  return mapRepository.findById(id);
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

  await mapRepository.upsert(map.id, map);

  return map.id;
}

/**
 * Deletes a map everywhere, not just in the database: removing only the
 * document would leave the map live in runtimeState, its NPCs ticking and
 * its players broadcast until a restart, and its quadtree never released.
 * Nothing calls this yet.
 */
export async function deleteMap(id: string): Promise<void> {
  await mapRepository.delete(id);

  const live = runtimeState.maps[id];
  if (live) {
    for (const npc of Object.values(live.npcs)) forgetReplicatedEntity(npc.id);
    delete runtimeState.maps[id];
  }
  dropQuadtree(id);
}

export async function listMaps(): Promise<MapStateServer[]> {
  return mapRepository.list();
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
          quantity: 1,
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

      const instanceId = `${npcId}:${rowIndex}:${colIndex}`;
      const runtimeNpc: RuntimeNpc = {
        ...baseNpc,
        id: instanceId,
        templateId: npcId,
        position: {
          x: colIndex * TILE_SIZE,
          y: rowIndex * TILE_SIZE,
        },
      };

      npcs[instanceId] = runtimeNpc;
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
