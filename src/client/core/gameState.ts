import type {
  MapChunkPayload,
  MapDynamicClient,
  MapMetaClient,
  MapStateClient,
  MapStaticClient,
  Player,
  PlayerCold,
  Tile,
} from '../../shared/types';
import type { FullGameStatePayload } from '../../shared/wsProtocol';
import { CHUNK_SIZE, TILE_SIZE } from '../../shared/constants';
import * as jsondiffpatch from 'jsondiffpatch';

const diffPatcher = jsondiffpatch.create({
  objectHash: (obj: any, index?: number): string | undefined => {
    return obj.id || obj.name || `$$index:${index}`;
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
});

let staticMap: MapStaticClient | null = null;
let staticMapRevision: number | null = null;
let dynamic: FullGameStatePayload | null = null;
let playerCold: PlayerCold | null = null;

let cachedMapW = 0;
let cachedMapH = 0;
export const getMapPixelSize = (): { w: number; h: number } => ({
  w: cachedMapW,
  h: cachedMapH,
});

let composedCache: MapStateClient | null = null;
let composedFromStatic: MapStaticClient | null = null;
let composedFromDynamicMap: MapDynamicClient | null = null;

export const getPlayer = (): Player | null => {
  if (!playerCold || !dynamic) return null;
  return { ...playerCold, ...dynamic.player };
};

export const getGameState = (): MapStateClient | null => {
  if (!staticMap || !dynamic) return null;

  const dynMap = dynamic.map;
  if (
    composedCache &&
    composedFromStatic === staticMap &&
    composedFromDynamicMap === dynMap
  ) {
    return composedCache;
  }

  composedCache = {
    id: staticMap.id,
    name: staticMap.name,
    type: staticMap.type,
    tiles: staticMap.tiles,
    droppedItems: dynMap.droppedItems,
    npcs: dynMap.npcs,
    players: dynMap.players,
  };
  composedFromStatic = staticMap;
  composedFromDynamicMap = dynMap;
  return composedCache;
};

export const setStaticMap = (payload: MapStaticClient) => {
  staticMap = payload;
};

function createEmptyGrid(cols: number, rows: number): Tile[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ tileIndex: -1, blocked: false })),
  );
}

export const setMapMeta = (meta: MapMetaClient) => {
  cachedMapW = meta.cols * TILE_SIZE;
  cachedMapH = meta.rows * TILE_SIZE;

  if (staticMap?.id === meta.id && staticMapRevision === meta.revision) {
    staticMap = {
      ...staticMap,
      name: meta.name,
      type: meta.type,
      pvp: meta.pvp,
    };
    return;
  }
  staticMap = {
    id: meta.id,
    name: meta.name,
    type: meta.type,
    pvp: meta.pvp,
    tiles: createEmptyGrid(meta.cols, meta.rows),
  };
  staticMapRevision = meta.revision;
};

export const applyMapChunk = (chunk: MapChunkPayload) => {
  if (
    !staticMap ||
    staticMap.id !== chunk.mapId ||
    staticMapRevision !== chunk.revision
  )
    return;
  const rowStart = chunk.chunkY * CHUNK_SIZE;
  const colStart = chunk.chunkX * CHUNK_SIZE;
  const newTiles = staticMap.tiles.slice();
  for (let r = 0; r < chunk.tiles.length; r++) {
    const mapRow = rowStart + r;
    if (mapRow >= newTiles.length) break;
    const newRow = newTiles[mapRow].slice();
    for (let c = 0; c < chunk.tiles[r].length; c++) {
      const mapCol = colStart + c;
      if (mapCol < newRow.length) newRow[mapCol] = chunk.tiles[r][c];
    }
    newTiles[mapRow] = newRow;
  }
  staticMap = { ...staticMap, tiles: newTiles };
};

export const removeEntities = (playerIds: string[], npcIds: string[]) => {
  if (!dynamic) return;
  for (const id of playerIds) delete dynamic.map.players[id];
  for (const id of npcIds) delete dynamic.map.npcs[id];
};

export const setPlayerStats = (payload: PlayerCold) => {
  playerCold = payload;
};

export const updatePlayerInventory = (inventory: PlayerCold['inventory']) => {
  if (!playerCold) return;
  playerCold = {
    ...playerCold,
    inventory,
  };
};

export const setFullGameState = (payload: FullGameStatePayload) => {
  dynamic = payload;
};

export const patchGameState = (delta: jsondiffpatch.Delta | undefined) => {
  if (dynamic && delta) {
    dynamic = diffPatcher.patch(
      dynamic,
      delta,
    ) as unknown as FullGameStatePayload;
  } else if (!dynamic) {
    console.warn('Attempted to patch but no dynamic game state exists.');
  } else if (!delta) {
    console.warn('Received a delta message but the delta was undefined.');
  }
};
