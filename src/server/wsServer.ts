import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import {
  disconnectPlayer,
  getGameState,
  handleKeyPress,
  handleKeyRelease,
} from './gameService';
import { ExtendedRequest } from './server';
import {
  ActionQueue,
  ActionQueueItem,
  ClientAction,
  ClientKeyboardAction,
  ClientItemAction,
  ServerAction,
  ServerActionType,
} from '../shared/types';
import { updateEnemies } from './enemyService';
import { RequestHandler } from 'express';
import { updateEnemy } from './database';
import {
  handleItemAction,
  handleKeyAction,
  removeItemFromInventory,
  useItem,
} from './playerService';

let wss: WebSocketServer;

const playersWsMap = new Map<string, WebSocket>();

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
        if (clientAction.type === 'keyboard') {
          enqueueAction({
            username,
            type: 'keyboard',
            keyboardAction: (clientAction as ClientKeyboardAction)
              .keyboardAction,
          } as ClientKeyboardAction);
        } else if (clientAction.type === 'item') {
          enqueueAction({
            username,
            type: 'item',
            item: (clientAction as ClientItemAction).item,
            action: (clientAction as ClientItemAction).action,
          });
        }
      });

      ws.on('close', () => {
        disconnectPlayer(username);
        playersWsMap.delete(username);
      });
    }
  });
};

setInterval(() => {
  processActions();
  broadcastGameState();
}, 50);

setInterval(() => {
  enqueueAction({ action: ServerActionType.UpdateEnemyPositions });
}, 500);

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
        }
      } else if (isServerAction(action)) {
        handleServerAction(action);
      }
    }
  }
}

function isClientAction(
  action: ActionQueueItem,
): action is ClientKeyboardAction | ClientItemAction {
  return (action as ClientAction).username !== undefined;
}

function isServerAction(action: ActionQueueItem): action is ServerAction {
  return (action as ServerAction).action !== undefined;
}

function handleServerAction(action: ServerAction) {
  switch (action.action) {
    case ServerActionType.UpdateEnemyPositions:
      const gameState = getGameState();
      Object.values(gameState.maps).forEach((map) => {
        Object.values(map.enemies).forEach((enemy) => {
          updateEnemies(enemy, map);
          updateEnemy(enemy);
        });
      });
      break;
  }
}

function broadcastGameState() {
  const gameState = getGameState();
  Object.values(gameState.maps).forEach((map) => {
    Object.values(map.players).forEach((player) => {
      const message = JSON.stringify({ map, player });
      const ws = playersWsMap.get(player.name);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });
}

export { broadcastGameState as broadcast };
