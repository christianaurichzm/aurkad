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
  ServerAction,
  ServerActionType,
  KeyboardAction,
} from '../shared/types';
import { updateEnemies } from './enemyService';
import { RequestHandler } from 'express';
import { updateEnemy } from './database';

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
        const keyboardAction: KeyboardAction = JSON.parse(message.toString());
        enqueueAction({ username, keyboardAction });
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
        switch (action.keyboardAction.type) {
          case 'press':
            handleKeyPress(action.username, action.keyboardAction.key);
            break;
          case 'release':
            handleKeyRelease(action.username, action.keyboardAction.key);
            break;
        }
      } else if (isServerAction(action)) {
        handleServerAction(action);
      }
    }
  }
}

function isClientAction(action: ActionQueueItem): action is ClientAction {
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
    const message = JSON.stringify(map);
    Object.values(map.players).forEach((player) => {
      const ws = playersWsMap.get(player.name);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });
}

export { broadcastGameState as broadcast };
