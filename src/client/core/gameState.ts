import type {
  MapDynamicClient,
  MapStateClient,
  MapStaticClient,
  Player,
  PlayerCold,
} from '../../shared/types';
import type { FullGameStatePayload } from '../../shared/wsProtocol';
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
let dynamic: FullGameStatePayload | null = null;
let playerCold: PlayerCold | null = null;

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
