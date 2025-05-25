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
  Player,
  MapStateServer,
} from '../shared/types';
import { getMap } from './gameData';
import { ExtendedRequest } from './server';
import { handleChatAction } from './services/chatService';
import {
  disconnectPlayer,
  handleKeyAction,
  getGameState,
  processMovementIntent,
  processMovementCompletion,
} from './services/gameService';
import { handleItemAction } from './services/inventoryService';
import { updateNpcs } from './services/npcService';
import { enrichPlayer, getPlayerByName } from './services/playerService';
import * as jsondiffpatch from 'jsondiffpatch';

let wss: WebSocketServer;

export const playersWsMap = new Map<string, WebSocket>();

const diffPatcher = jsondiffpatch.create({
  objectHash: (obj: any, index?: number): string | undefined => {
    return obj.id || obj.name || `$$index:${index}`;
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
});

export const startWebSocketServer = (
  server: Server,
  sessionMiddleware: RequestHandler,
) => {
  wss = new WebSocketServer({ noServer: true, path: '/ws' });

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') {
      socket.destroy();
      return;
    }

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
  const TICK_RATE = process.env.TICK_RATE ? Number(process.env.TICK_RATE) : 20;
  const MAX_UPDATES_PER_TICK = process.env.MAX_UPDATES_PER_TICK
    ? Number(process.env.MAX_UPDATES_PER_TICK)
    : 2;

  const tickInterval = 1000 / TICK_RATE;
  let lastUpdateTime = Date.now();

  const tick = () => {
    const now = Date.now();
    let updates = 0;

    while (
      now - lastUpdateTime >= tickInterval &&
      updates < MAX_UPDATES_PER_TICK
    ) {
      processActions();
      processMovementIntent();
      processMovementCompletion();
      broadcastGameState();
      lastUpdateTime += tickInterval;
      updates++;
    }

    setTimeout(tick, tickInterval - (Date.now() - lastUpdateTime));
  };

  tick();

  setInterval(() => {
    enqueueAction({ action: ServerActionType.UpdateNpcPositions });
  }, 1000);
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

export const lastSentStates = new Map<
  string,
  { map: MapStateServer; player: Player }
>();

function broadcastGameState() {
  const gameState = getGameState();

  for (const map of Object.values(gameState.maps)) {
    for (const player of Object.values(map.players)) {
      const ws = playersWsMap.get(player.name);

      if (ws?.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        const enrichedPlayer = enrichPlayer(player);

        const currentState = structuredClone({
          map: {
            ...map,
            players: Object.fromEntries(
              Object.entries(map.players).filter(([id]) => id !== player.id),
            ),
          },
          player: enrichedPlayer,
        });

        const lastState = lastSentStates.get(player.name);
        let message: { type: string; payload: any } | null = null;

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
      } catch (error) {
        console.error(`Error broadcasting to ${player.name}:`, error);
      }
    }
  }
}

export { broadcastGameState as broadcast };
