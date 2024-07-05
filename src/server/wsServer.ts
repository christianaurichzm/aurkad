import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import {
  disconnectPlayer,
  getGameState,
  handleKeyPress,
  handleKeyRelease,
} from './gameService';
import { ExtendedRequest } from './server';
import { ActionQueue, KeyboardAction, ClientAction } from '../shared/types';
import { RequestHandler } from 'express';
import { updateEnemies } from './enemyService';

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
    setInterval(broadcast, 50);
  });

  wss.on('connection', (ws: WebSocket, request: ExtendedRequest) => {
    const session = request.session;

    if (!session?.username) {
      ws.close();
      return;
    }

    const { username } = session;

    playersWsMap.set(username, ws);

    ws.on('message', (message: string) => {
      const data: KeyboardAction = JSON.parse(message);

      enqueueAction({ username: username, keyboardAction: data });
    });

    ws.on('close', () => {
      disconnectPlayer(session?.username);
      console.log('User disconnected', session.username);
    });
  });
};

const actionQueue: ActionQueue = [];

export function enqueueAction(action: ClientAction) {
  actionQueue.push(action);
}

export async function processActions() {
  while (actionQueue.length > 0) {
    const action = actionQueue.shift();

    if (action) {
      switch (action?.keyboardAction.type) {
        case 'press':
          handleKeyPress(action.username, action.keyboardAction.key);
          break;
        case 'release':
          handleKeyRelease(action.username, action.keyboardAction.key);
          break;
      }
    }
  }
}

export const broadcast = () => {
  processActions();

  const gameState = getGameState();

  Object.values(gameState.maps).forEach((map) => {
    Object.values(map.enemies).forEach((enemy) => {
      updateEnemies(enemy, map);
    });

    const message = JSON.stringify(map);
    Object.values(map.players).forEach((player) => {
      const ws = playersWsMap.get(player.name);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });
};
