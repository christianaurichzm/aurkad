import WebSocket, { RawData, WebSocketServer } from 'ws';
import { Server } from 'http';
import { disconnectPlayer, getGameState } from './gameService';
import { ExtendedRequest } from './server';
import { enqueueAction, processActions } from './actionQueue';
import { KeyboardAction } from '../shared/types';
import { RequestHandler } from 'express';

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

  processActions();
  setInterval(broadcastGameState, 1000 / 60);

  wss.on('connection', (ws: WebSocket, request: ExtendedRequest) => {
    const session = request.session;

    if (!session?.username) {
      ws.close();
      return;
    }

    const { username } = session;

    playersWsMap.set(username, ws);

    ws.on('message', (message: RawData) => {
      const data: KeyboardAction = JSON.parse(message.toString());

      if (data.type === 'press' || data.type === 'release') {
        enqueueAction({ username, keyboardAction: data });
      }
    });

    ws.on('close', () => {
      disconnectPlayer(session?.username);
      console.log('User disconnected', session.username);
    });
  });
};

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
