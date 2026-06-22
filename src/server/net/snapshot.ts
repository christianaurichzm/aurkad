import WebSocket from 'ws';
import * as jsondiffpatch from 'jsondiffpatch';
import {
  ChatMessagePayload,
  MapStateServer,
  PlayerServer,
} from '../../shared/types.js';
import type {
  FullGameStatePayload,
  GameStateDeltaPayload,
} from '../../shared/wsProtocol.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getMap } from '../gameData.js';
import { getGameState } from '../services/gameService.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { toMapDynamicClient, toMapStaticClient } from './serialization.js';
import {
  getPlayerByName,
  playerColdSignature,
  toPlayerCold,
  toPlayerHot,
} from '../services/playerService.js';
import { TILE_SIZE } from '../../shared/constants.js';
import { playersWsMap } from './connections.js';

const diffPatcher = jsondiffpatch.create({
  objectHash: (obj: any, index?: number): string | undefined => {
    return obj.id || obj.name || `$$index:${index}`;
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
});

export const lastSentStates = new Map<string, FullGameStatePayload>();
const lastSentMapId = new Map<string, string>();
const lastSentMapRevision = new Map<string, number>();
const lastSentPlayerColdSig = new Map<string, string>();

export function resetPlayerNetState(name: string) {
  lastSentStates.delete(name);
  lastSentMapId.delete(name);
  lastSentMapRevision.delete(name);
  lastSentPlayerColdSig.delete(name);
}

function sendStaticMapIfNeeded(
  player: PlayerServer,
  map: MapStateServer,
  mapRevision: number,
  ws: WebSocket,
) {
  const needsStaticMap =
    lastSentMapId.get(player.name) !== map.id ||
    lastSentMapRevision.get(player.name) !== mapRevision;

  if (!needsStaticMap) return;

  ws.send(
    JSON.stringify({ type: 'mapStatic', payload: toMapStaticClient(map) }),
  );
  lastSentMapId.set(player.name, map.id);
  lastSentMapRevision.set(player.name, mapRevision);
  lastSentStates.delete(player.name);
}

function sendPlayerStatsIfNeeded(player: PlayerServer, ws: WebSocket) {
  const signature = playerColdSignature(player);
  if (lastSentPlayerColdSig.get(player.name) === signature) return;

  ws.send(
    JSON.stringify({ type: 'playerStats', payload: toPlayerCold(player) }),
  );
  lastSentPlayerColdSig.set(player.name, signature);
}

function sendDynamicSnapshot(
  player: PlayerServer,
  map: MapStateServer,
  ws: WebSocket,
  interestRadiusPx: number,
) {
  const currentState: FullGameStatePayload = structuredClone({
    map: toMapDynamicClient(map, player, interestRadiusPx),
    player: toPlayerHot(player),
  });

  const lastState = lastSentStates.get(player.name);
  let message: {
    type: string;
    payload: FullGameStatePayload | GameStateDeltaPayload;
  } | null = null;

  if (!lastState) {
    message = { type: 'fullGameState', payload: currentState };
  } else {
    const delta = diffPatcher.diff(lastState, currentState);
    if (delta) {
      message = { type: 'gameStateDelta', payload: delta };
    }
  }

  if (message) {
    ws.send(JSON.stringify(message));
    lastSentStates.set(player.name, currentState);
  }
}

export function broadcastGameState() {
  const gameState = getGameState();
  const interestRadiusPx = config.net.interestRadiusTiles * TILE_SIZE;

  for (const map of Object.values(gameState.maps)) {
    const mapRevision = map.tilesRevision ?? 0;

    for (const player of Object.values(map.players)) {
      const ws = playersWsMap.get(player.name);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;

      try {
        sendStaticMapIfNeeded(player, map, mapRevision, ws);
        sendPlayerStatsIfNeeded(player, ws);
        sendDynamicSnapshot(player, map, ws, interestRadiusPx);
      } catch (error) {
        logger.error('Error broadcasting to player', {
          player: player.name,
          err: error,
        });
      }
    }
  }
}

export function broadcastChat(message: ChatMessagePayload) {
  const data = JSON.stringify(message);

  playersWsMap.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

export function broadcastMapChat(
  senderUsername: string,
  message: ChatMessagePayload,
) {
  const player = getPlayerByName(senderUsername);
  const map = getMap(player?.mapId);

  Object.values(map?.players ?? {}).forEach((p) => {
    const ws = playersWsMap.get(p.name);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

export function broadcastToMap(mapId: string, message: ChatMessagePayload) {
  const map = getMap(mapId);
  if (!map) return;

  Object.values(map.players).forEach((player) => {
    const ws = playersWsMap.get(player.name);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

export function flushGameEvents() {
  const events = drainGameEvents();
  if (events.length === 0) return;

  for (const event of events) {
    switch (event.type) {
      case 'openShop': {
        const ws = playersWsMap.get(event.username);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'openShop', shopId: event.shopId }));
        }
        break;
      }
      case 'chatGlobal':
        broadcastChat(event.payload);
        break;
      case 'chatMap':
        broadcastMapChat(event.senderUsername, event.payload);
        break;
      case 'chatMapId':
        broadcastToMap(event.mapId, event.payload);
        break;
      case 'chatPlayer': {
        const ws = playersWsMap.get(event.username);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(event.payload));
        }
        break;
      }
      case 'customPlayer': {
        const ws = playersWsMap.get(event.username);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'custom',
              channel: event.channel,
              payload: event.payload,
            }),
          );
        }
        break;
      }
      case 'customMap':
        sendCustomToMap(event.mapId, event.channel, event.payload);
        break;
      case 'customAll':
        broadcastCustom(event.channel, event.payload);
        break;
    }
  }
}

function broadcastCustom(channel: string, payload: unknown) {
  const data = JSON.stringify({ type: 'custom', channel, payload });
  playersWsMap.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function sendCustomToMap(mapId: string, channel: string, payload: unknown) {
  const map = getMap(mapId);
  if (!map) return;
  const data = JSON.stringify({ type: 'custom', channel, payload });
  Object.values(map.players).forEach((player) => {
    const ws = playersWsMap.get(player.name);
    if (ws?.readyState === WebSocket.OPEN) ws.send(data);
  });
}

export { broadcastGameState as broadcast };
