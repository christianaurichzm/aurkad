import type {
  MapChunkPayload,
  MapDynamicClient,
  MapMetaClient,
  MapStateClient,
  MapStaticClient,
  Player,
  PlayerCold,
  PlayerPublic,
  RuntimeNpc,
  Tile,
} from '../../shared/types';
import type {
  FullGameStatePayload,
  WorldUpdatePayload,
} from '../../shared/wsProtocol';
import { CHUNK_SIZE, TILE_SIZE } from '../../shared/constants';

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

// Seeds the local world before the first server update arrives (GameInterface
// does this from the session payload). Not a wire message handler.
export const setFullGameState = (payload: FullGameStatePayload) => {
  dynamic = payload;
};

// `null` on the wire means the field was cleared, since JSON cannot carry
// undefined; the key is deleted.
function mergeEntity(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/**
 * Merges one per-tick world update into the local world. An entering
 * entity arrives complete, so known ids merge by field and unknown ones are
 * inserted by `kind`. `dynamic` is reassigned because getGameState()
 * caches by object identity.
 */
export const applyWorldUpdate = (payload: WorldUpdatePayload) => {
  const players: Record<string, PlayerPublic> = dynamic
    ? { ...dynamic.map.players }
    : {};
  const npcs: Record<string, RuntimeNpc> = dynamic
    ? { ...dynamic.map.npcs }
    : {};

  for (const [id, patch] of Object.entries(payload.entities ?? {})) {
    if (players[id]) {
      players[id] = mergeEntity(
        players[id] as unknown as Record<string, unknown>,
        patch as Record<string, unknown>,
      ) as unknown as PlayerPublic;
    } else if (npcs[id]) {
      npcs[id] = mergeEntity(
        npcs[id] as unknown as Record<string, unknown>,
        patch as Record<string, unknown>,
      ) as unknown as RuntimeNpc;
    } else if ((patch as { kind?: string }).kind === 'npc') {
      npcs[id] = patch as RuntimeNpc;
    } else {
      players[id] = patch as PlayerPublic;
    }
  }

  for (const id of payload.leave ?? []) {
    delete players[id];
    delete npcs[id];
  }

  dynamic = {
    map: {
      id: dynamic?.map.id ?? '',
      droppedItems: payload.droppedItems ?? dynamic?.map.droppedItems ?? [],
      players,
      npcs,
    },
    player: payload.self,
  };
};
