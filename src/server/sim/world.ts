import { GameState, MapStateServer, PlayerServer } from '../../shared/types.js';
import { markPlayerDirty } from '../persistence/dirtyPlayers.js';
import { players, playersByName, runtimeState } from './state.js';
import { logger } from '../logger.js';
import { indexArrival } from './spatialManager.js';

export function getPlayerById(id: string): PlayerServer | undefined {
  return players[id];
}

export function getPlayerByName(name: string): PlayerServer | undefined {
  return playersByName.get(name);
}

export function getAllPlayers(): PlayerServer[] {
  return Object.values(players);
}

export function registerPlayer(player: PlayerServer): void {
  players[player.id] = player;
  playersByName.set(player.name, player);
}

export function unregisterPlayer(id: string): void {
  const existing = players[id];
  if (existing) playersByName.delete(existing.name);
  delete players[id];
  for (const map of Object.values(runtimeState.maps)) {
    delete map.players[id];
  }
}

/**
 * Only the object `enterWorld` registered counts. A stale reference (an
 * arrow, a timer) must not write a logged-out player back into the world.
 */
const inWorld = (player: PlayerServer): boolean =>
  players[player.id] === player;

export function upsertOnCurrentMap(player: PlayerServer): void {
  if (!inWorld(player)) return;
  const map = runtimeState.maps[player.mapId];
  if (map) {
    map.players[player.id] = player;
  } else {
    logger.warn('upsertOnCurrentMap: Map not found', { mapId: player.mapId });
  }
}

export function placePlayerOnMap(
  player: PlayerServer,
  previousMapId?: string,
): MapStateServer | undefined {
  if (!inWorld(player)) return undefined;
  const prevMapId = previousMapId ?? getPlayerById(player.id)?.mapId;

  if (prevMapId && prevMapId !== player.mapId) {
    const prevMap = runtimeState.maps[prevMapId];
    if (prevMap?.players?.[player.id]) {
      delete prevMap.players[player.id];
    }
  }

  const nextMap = runtimeState.maps[player.mapId];
  if (!nextMap) return undefined;
  nextMap.players[player.id] = player;
  if (prevMapId !== player.mapId) indexArrival(nextMap, player);
  return nextMap;
}

export function detachFromMap(id: string): MapStateServer | undefined {
  const player = players[id];
  const map = player && runtimeState.maps[player.mapId];
  if (!map) return undefined;
  delete map.players[id];
  return map;
}

export function getRuntimeState(): GameState {
  return runtimeState;
}

export function getMap(mapId?: string): MapStateServer | undefined {
  if (!mapId) return;
  return runtimeState.maps[mapId];
}

export function updateMap(map: MapStateServer): MapStateServer | undefined {
  if (!runtimeState.maps[map.id]) {
    logger.warn('updateMap: Map not found', { mapId: map.id });
    return;
  }
  runtimeState.maps[map.id] = map;
  return map;
}

/** `getPlayerById` for callers that expect them online: a miss is logged. */
export function getPlayer(playerId: string): PlayerServer | undefined {
  const player = getPlayerById(playerId);
  if (!player) logger.warn('getPlayer: Player not found', { playerId });
  return player;
}

// Synchronous: write-behind only marks the player dirty.
export function updatePlayer(player: PlayerServer): void {
  if (!inWorld(player)) return;
  upsertOnCurrentMap(player);
  markPlayerDirty(player.id);
}
