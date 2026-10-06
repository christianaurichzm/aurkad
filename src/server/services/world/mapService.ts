import { TILE_SIZE } from '../../../shared/constants.js';
import {
  Tile,
  MapStateServer,
  MapType,
  MapOrientation,
  DroppedItem,
  PlayerServer,
  RuntimeNpc,
  Direction,
  CharacterAction,
} from '../../../shared/types.js';
import {
  getMap,
  getPlayer,
  runtimeState,
  updateMapById,
  updatePlayer,
} from './gameData.js';
import { placePlayerOnMap, detachFromMap } from '../../sim/world.js';

import { emit } from '../../engine/hooks.js';
import { mapRepository } from '../../persistence/mapRepository.js';
import { dropQuadtree } from '../../sim/spatialManager.js';
import { forgetReplicatedEntity, resendChunkAt } from '../../net/snapshot.js';
import { getNextMapId } from '../dbService.js';
import { getItemById } from '../content/itemService.js';
import { getNpcById } from '../content/npcService.js';
import { onMap } from './physicsService.js';

export async function getMapById(id: string): Promise<MapStateServer | null> {
  return mapRepository.findById(id);
}

export async function createOrUpdateMap(
  map: Partial<MapStateServer>,
): Promise<string> {
  // A dungeon copy is runtime only; saving one would write a map document
  // whose id nobody can reach, or overwrite the template with whatever one
  // run did to it.
  if (map.id?.includes('#')) {
    throw new Error(`[map] ${map.id} is an instance and cannot be saved`);
  }
  if (!map.id) {
    map.id = (await getNextMapId()).toString();
  }

  const previous = runtimeState.maps[map.id];

  const merged = { ...previous, ...map } as MapStateServer;

  const staticChanged =
    map.tiles !== undefined ||
    map.name !== undefined ||
    map.type !== undefined ||
    map.orientation !== undefined;
  if (staticChanged) {
    merged.tilesRevision = (previous?.tilesRevision ?? 0) + 1;
  }

  runtimeState.maps[map.id] = merged;
  if (map.tiles !== undefined) {
    for (const player of Object.values(merged.players ?? {})) {
      const position = onMap(player, map.id, player.position);
      const target = player.targetPosition ?? player.position;
      const next = onMap(player, map.id, target);
      if (
        position.x === player.position.x &&
        position.y === player.position.y &&
        next.x === target.x &&
        next.y === target.y
      )
        continue;
      // Movement reads map services during boot; loading it here avoids
      // entering the tick loop before its movement systems are initialized.
      const { teleportPlayer } = await import('./movementService.js');
      teleportPlayer(player, map.id, position);
      updatePlayer(player);
    }
    emit('mapChange', { mapId: map.id });
  }

  await mapRepository.upsert(map.id, map);

  return map.id;
}

/**
 * Changes one tile of a live map: the picture on its ground layer, whether
 * it blocks, or both. Runtime only: a restart, an editor save or a content
 * import puts back what was painted, and each copy of an instanced map
 * keeps its own. Everyone on the map gets the tile's chunk again and
 * `mapChange` fires; changing a tile to what it is does neither. False
 * when (col, row) is not on the map or the index is not one.
 */
export function setMapTile(
  mapId: string,
  col: number,
  row: number,
  change: { tileIndex?: number; blocked?: boolean },
): boolean {
  const r = Math.floor(row);
  const c = Math.floor(col);
  const tile = getMap(mapId)?.tiles[r]?.[c];
  if (!tile) return false;
  const tileIndex = change.tileIndex ?? tile.tileIndex;
  if (!Number.isInteger(tileIndex)) return false;
  const blocked = !!(change.blocked ?? tile.blocked);
  if (tileIndex === tile.tileIndex && blocked === !!tile.blocked) return true;

  tile.tileIndex = tileIndex;
  tile.blocked = blocked;
  resendChunkAt(mapId, c, r);
  emit('mapChange', { mapId });
  return true;
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
  insertItems(partialMap, tiles);

  const newMap = {
    ...baseMap,
    ...partialMap,
  };

  return newMap;
};

export const mapSave = async (
  mapId: string,
  tiles: Tile[][],
  name: string,
  type: MapType,
  music?: string,
  orientation?: MapOrientation,
) => {
  const newMap = await insertModeCell(mapId, tiles);
  await updateMapById({
    ...newMap,
    name,
    type,
    music,
    ...(orientation && { orientation }),
  } as MapStateServer);
};

export const insertItems = (
  partialMap: Partial<MapStateServer>,
  tiles: Tile[][],
) => {
  const droppedItems: DroppedItem[] = [];

  for (let rowIndex = 0; rowIndex < tiles.length; rowIndex++) {
    const row = tiles[rowIndex]!;
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const tile = row[colIndex]!;
      if (tile.item) {
        const item = getItemById(tile.item);
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

const tileSized = (value: number | undefined) =>
  Number.isFinite(value) && (value as number) > 0
    ? (value as number)
    : TILE_SIZE;

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
            // The stored document is whatever wrote it (a content
            // pack, a hand-edited collection), and a box narrower
            // than a tile makes the health bar miss the sprite and
            // puts the tile next door out of melee reach. spawnNpc
            // normalises the same way.
            width: tileSized(base.width),
            height: tileSized(base.height),
            attackRange: tileSized(base.attackRange),
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
