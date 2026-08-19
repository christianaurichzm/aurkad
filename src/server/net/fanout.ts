import WebSocket from 'ws';
import { ChatMessagePayload } from '../../shared/types.js';
import { getMap } from '../services/world/gameData.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { getPlayerByName } from '../services/player/playerService.js';
import { hearsFrom } from '../services/world/serverState.js';
import { playersWsMap } from './connections.js';

// Chat and custom-event fan-out to connected clients. Kept separate from the
// per-player game-state snapshot in snapshot.ts: these functions hold no
// snapshot/delta state, they just route a message to the relevant sockets.

export function broadcastChat(message: ChatMessagePayload) {
  const data = JSON.stringify(message);

  playersWsMap.forEach((ws, name) => {
    if (ws.readyState === WebSocket.OPEN && hearsFrom(name, message.username)) {
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
    if (
      ws?.readyState === WebSocket.OPEN &&
      hearsFrom(p.name, message.username)
    ) {
      ws.send(JSON.stringify(message));
    }
  });
}

export function broadcastToMap(mapId: string, message: ChatMessagePayload) {
  const map = getMap(mapId);
  if (!map) return;

  Object.values(map.players).forEach((player) => {
    const ws = playersWsMap.get(player.name);
    if (
      ws?.readyState === WebSocket.OPEN &&
      hearsFrom(player.name, message.username)
    ) {
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
        if (
          ws?.readyState === WebSocket.OPEN &&
          hearsFrom(event.username, event.payload.username)
        ) {
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
