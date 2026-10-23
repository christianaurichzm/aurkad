import WebSocket from 'ws';
import { ChatMessagePayload } from '../../shared/types.js';
import { getMap } from '../sim/world.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { getPlayerByName } from '../services/player/playerService.js';
import { hearsFrom } from '../services/serverState.js';
import { playersWsMap } from './connections.js';
import { config } from '../config.js';

// Chat and custom-event fan-out to connected clients. Kept separate from the
// per-player game-state snapshot in snapshot.ts: these functions hold no
// snapshot/delta state, they just route a message to the relevant sockets.

// The snapshot's backpressure rule, for everything else that goes out. A
// socket this far behind is sent nothing more until it drains: a client that
// reads slowly, or never, would otherwise hold the server's whole chat in
// this process's memory.
function deliver(ws: WebSocket | undefined, data: string): void {
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > config.ws.maxBufferedBytes) return;
  ws.send(data);
}

export function broadcastChat(message: ChatMessagePayload) {
  const data = JSON.stringify(message);

  playersWsMap.forEach((ws, name) => {
    if (hearsFrom(name, message.username)) deliver(ws, data);
  });
}

export function broadcastMapChat(
  senderUsername: string,
  message: ChatMessagePayload,
) {
  const player = getPlayerByName(senderUsername);
  const map = getMap(player?.mapId);
  const data = JSON.stringify(message);

  Object.values(map?.players ?? {}).forEach((p) => {
    if (hearsFrom(p.name, message.username))
      deliver(playersWsMap.get(p.name), data);
  });
}

export function broadcastToMap(mapId: string, message: ChatMessagePayload) {
  const map = getMap(mapId);
  if (!map) return;
  const data = JSON.stringify(message);

  Object.values(map.players).forEach((player) => {
    if (hearsFrom(player.name, message.username))
      deliver(playersWsMap.get(player.name), data);
  });
}

export function flushGameEvents() {
  const events = drainGameEvents();
  if (events.length === 0) return;

  for (const event of events) {
    switch (event.type) {
      case 'openShop':
        deliver(
          playersWsMap.get(event.username),
          JSON.stringify({ type: 'openShop', shopId: event.shopId }),
        );
        break;
      case 'chatGlobal':
        broadcastChat(event.payload);
        break;
      case 'chatMap':
        broadcastMapChat(event.senderUsername, event.payload);
        break;
      case 'chatMapId':
        broadcastToMap(event.mapId, event.payload);
        break;
      case 'chatPlayer':
        if (hearsFrom(event.username, event.payload.username))
          deliver(
            playersWsMap.get(event.username),
            JSON.stringify(event.payload),
          );
        break;
      case 'customPlayer':
        deliver(
          playersWsMap.get(event.username),
          JSON.stringify({
            type: 'custom',
            channel: event.channel,
            payload: event.payload,
          }),
        );
        break;
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
  playersWsMap.forEach((ws) => deliver(ws, data));
}

function sendCustomToMap(mapId: string, channel: string, payload: unknown) {
  const map = getMap(mapId);
  if (!map) return;
  const data = JSON.stringify({ type: 'custom', channel, payload });
  Object.values(map.players).forEach((player) =>
    deliver(playersWsMap.get(player.name), data),
  );
}
