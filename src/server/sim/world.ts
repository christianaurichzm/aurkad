import { MapStateServer, PlayerServer } from '../../shared/types.js';
import { players, playersByName, runtimeState } from './state.js';
import { logger } from '../logger.js';

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

export function upsertOnCurrentMap(player: PlayerServer): void {
  registerPlayer(player);
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
  const prevMapId = previousMapId ?? getPlayerById(player.id)?.mapId;

  registerPlayer(player);

  if (prevMapId && prevMapId !== player.mapId) {
    const prevMap = runtimeState.maps[prevMapId];
    if (prevMap?.players?.[player.id]) {
      delete prevMap.players[player.id];
    }
  }

  const nextMap = runtimeState.maps[player.mapId];
  if (!nextMap) return undefined;
  nextMap.players[player.id] = player;
  return nextMap;
}

export function detachFromMap(id: string): MapStateServer | undefined {
  const player = players[id];
  const map = player && runtimeState.maps[player.mapId];
  if (!map) return undefined;
  delete map.players[id];
  return map;
}
