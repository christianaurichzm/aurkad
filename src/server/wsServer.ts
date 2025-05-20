import { RequestHandler } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import {
  ClientAction,
  ClientKeyboardAction,
  ClientItemAction,
  ClientChatAction,
  ServerActionType,
  ActionQueue,
  ActionQueueItem,
  ChatMessagePayload,
  ServerAction,
} from '../shared/types';
import { getMap } from './gameData';
import { ExtendedRequest } from './server';
import { handleChatAction } from './services/chatService';
import {
  disconnectPlayer,
  handleKeyAction,
  getPlayerByName,
  getGameState,
} from './services/gameService';
import { handleItemAction } from './services/inventoryService';
import { updateNpcs } from './services/npcService';
import { enrichPlayer } from './services/playerService';

let wss: WebSocketServer;

export const playersWsMap = new Map<string, WebSocket>();

export const startWebSocketServer = (
  server: Server,
  sessionMiddleware: RequestHandler,
) => {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    sessionMiddleware(request as ExtendedRequest, {} as any, () => {
      if ((request as ExtendedRequest).session.username) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });
  });

  wss.on('connection', (ws: WebSocket, request: ExtendedRequest) => {
    const username = request.session.username;
    if (username) {
      playersWsMap.set(username, ws);

      ws.on('message', (message) => {
        const clientAction: ClientAction = JSON.parse(message.toString());

        switch (clientAction.type) {
          case 'keyboard':
            enqueueAction({
              username,
              type: 'keyboard',
              keyboardAction: (clientAction as ClientKeyboardAction)
                .keyboardAction,
            });
            break;

          case 'item':
            enqueueAction({
              username,
              type: 'item',
              item: (clientAction as ClientItemAction).item,
              action: (clientAction as ClientItemAction).action,
            });
            break;

          case 'chat':
            enqueueAction({
              username,
              type: 'chat',
              message: (clientAction as ClientChatAction).message,
              scope: (clientAction as ClientChatAction).scope,
            });
            break;
        }
      });

      ws.on('close', () => {
        disconnectPlayer(username);
        playersWsMap.delete(username);
      });
    }
  });
};

const actionQueue: ActionQueue = [];

function enqueueAction(action: ActionQueueItem) {
  actionQueue.push(action);
}

export async function processActions() {
  while (actionQueue.length > 0) {
    const action = actionQueue.shift();

    if (action) {
      if (isClientAction(action)) {
        if (action.type === 'keyboard') {
          handleKeyAction(action);
        } else if (action.type === 'item') {
          handleItemAction(action);
        } else if (action.type === 'chat') {
          handleChatAction(action);
        }
      } else if (isServerAction(action)) {
        handleServerAction(action);
      }
    }
  }
}

export function startGameLoops() {
  setInterval(() => {
    processActions();
    broadcastGameState();
  }, 50);

  setInterval(() => {
    enqueueAction({ action: ServerActionType.UpdateNpcPositions });
  }, 500);
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

  Object.values(map?.players ?? {}).forEach((player) => {
    const ws = playersWsMap.get(player.name);
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

function isClientAction(
  action: ActionQueueItem,
): action is ClientKeyboardAction | ClientItemAction | ClientChatAction {
  return (action as ClientAction).username !== undefined;
}

function isServerAction(action: ActionQueueItem): action is ServerAction {
  return (action as ServerAction).action !== undefined;
}

function handleServerAction(action: ServerAction) {
  switch (action.action) {
    case ServerActionType.UpdateNpcPositions:
      Object.values(getGameState().maps).forEach((map) => {
        Object.values(map.npcs).forEach((npc) => {
          updateNpcs(npc, map);
        });
      });
      break;
  }
}

function broadcastGameState() {
  const gameState = getGameState();
  Object.values(gameState.maps).forEach(async (map) => {
    await Promise.all(
      Object.values(map.players).map(async (player) => {
        const enrichedPlayer = await enrichPlayer(player);
        const message = JSON.stringify({ map, player: enrichedPlayer });
        const ws = playersWsMap.get(player.name);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }),
    );
  });
}

export { broadcastGameState as broadcast };
