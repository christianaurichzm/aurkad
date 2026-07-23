import type {
  DroppedItem,
  MapChunkPayload,
  MapDynamicClient,
  MapMetaClient,
  MapStateClient,
  MapStaticClient,
  MapStateServer,
  PlayerPublic,
  PlayerServer,
  Position,
  RuntimeNpc,
} from '../../shared/types.js';
import {
  type Viewport,
  mapTileWidth,
  mapTileHeight,
} from '../../shared/mapGeometry.js';
import { CHUNK_SIZE } from '../../shared/constants.js';
import { queryEntitiesInRect } from '../spatial/spatialManager.js';

export function toPlayerPublic(player: PlayerServer): PlayerPublic {
  return {
    id: player.id,
    name: player.name,
    sprite: player.sprite,
    width: player.width,
    height: player.height,
    maxHealth: player.maxHealth,
    health: player.health,
    level: player.level,
    access: player.access,
    position: { ...player.position },
    targetPosition: player.targetPosition
      ? { ...player.targetPosition }
      : undefined,
    direction: player.direction,
    action: player.action,
    nameColor: player.nameColor,
    nameTag: player.nameTag,
    kind: 'player',
  };
}

function withinViewport(pos: Position, vp: Viewport): boolean {
  return (
    pos.x >= vp.left &&
    pos.x <= vp.right &&
    pos.y >= vp.top &&
    pos.y <= vp.bottom
  );
}

export function toMapStaticClient(map: MapStateServer): MapStaticClient {
  return {
    id: map.id,
    name: map.name,
    type: map.type,
    pvp: map.pvp,
    tiles: map.tiles,
  };
}

export function toMapMeta(map: MapStateServer): MapMetaClient {
  return {
    id: map.id,
    name: map.name,
    type: map.type,
    pvp: map.pvp,
    cols: mapTileWidth(map.tiles),
    rows: mapTileHeight(map.tiles),
    revision: map.tilesRevision ?? 0,
    music: map.music,
  };
}

export function toMapChunk(
  map: MapStateServer,
  chunkX: number,
  chunkY: number,
): MapChunkPayload {
  const rowStart = chunkY * CHUNK_SIZE;
  const colStart = chunkX * CHUNK_SIZE;
  const tiles = map.tiles
    .slice(rowStart, rowStart + CHUNK_SIZE)
    .map((row) => row.slice(colStart, colStart + CHUNK_SIZE));
  return {
    mapId: map.id,
    revision: map.tilesRevision ?? 0,
    chunkX,
    chunkY,
    tiles,
  };
}

// Positions are copied so the broadcast state never aliases the live entity
// (the sim mutates it in place every tick).
export function toNpcPublic(npc: RuntimeNpc): RuntimeNpc {
  return {
    ...npc,
    position: { ...npc.position },
    targetPosition: npc.targetPosition ? { ...npc.targetPosition } : undefined,
  };
}

export function toMapDynamicClient(
  map: MapStateServer,
  viewer: PlayerServer,
  viewport: Viewport,
): MapDynamicClient {
  const nearby = queryEntitiesInRect(map.id, {
    x: viewport.left,
    y: viewport.top,
    width: viewport.right - viewport.left,
    height: viewport.bottom - viewport.top,
  });

  const players: Record<string, PlayerPublic> = {};
  const npcs: Record<string, RuntimeNpc> = {};

  for (const entity of nearby) {
    if (!entity.id) continue;
    if (entity.kind === 'player') {
      if (entity.id === viewer.id) continue;
      const other = map.players[entity.id];
      if (other) players[entity.id] = toPlayerPublic(other);
    } else if (entity.kind === 'npc') {
      const npc = map.npcs[entity.id];
      if (npc) npcs[entity.id] = toNpcPublic(npc);
    }
  }

  const droppedItems = map.droppedItems.filter((item: DroppedItem) =>
    withinViewport(item.position, viewport),
  );

  return {
    id: map.id,
    droppedItems,
    npcs,
    players,
  };
}

export function toMapStateClient(
  map: MapStateServer,
  viewer: PlayerServer,
  viewport: Viewport,
): MapStateClient {
  return {
    ...toMapStaticClient(map),
    ...toMapDynamicClient(map, viewer, viewport),
  };
}
