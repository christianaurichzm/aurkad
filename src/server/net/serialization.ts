import type {
  MapChunkPayload,
  MapMetaClient,
  MapStateServer,
  PlayerPublic,
  PlayerServer,
  RuntimeNpc,
  Tile,
  TilePublic,
} from '../../shared/types.js';
import { mapTileWidth, mapTileHeight } from '../../shared/mapGeometry.js';
import { CHUNK_SIZE } from '../../shared/constants.js';

// Server -> client shaping for the live wire format: entity public state,
// map metadata, and tile chunks.

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

// Named rather than inlined so the list of what a player may know about a tile
// is one thing to read. A field added to `Tile` does not join it by default,
// which is the point: the last one that did was a script trigger.
function toTilePublic(tile: Tile): TilePublic {
  return {
    tileIndex: tile.tileIndex,
    maskIndex: tile.maskIndex,
    fringeIndex: tile.fringeIndex,
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
    .map((row) => row.slice(colStart, colStart + CHUNK_SIZE).map(toTilePublic));
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
  // scriptParams is the behaviour's server-side config: no client reads it,
  // and as an object it would be stringified for every npc's delta every
  // tick. The ai tuning beside it is server-side too, read over REST.
  const {
    scriptParams: _scriptParams,
    sight: _sight,
    pathDepth: _pathDepth,
    leash: _leash,
    moveIntervalMs: _moveIntervalMs,
    respawnMs: _respawnMs,
    ...rest
  } = npc;
  return {
    ...rest,
    position: { ...npc.position },
    targetPosition: npc.targetPosition ? { ...npc.targetPosition } : undefined,
  };
}
