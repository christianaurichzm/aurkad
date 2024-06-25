import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import { PlayerAction } from '../shared/types';
import { getMap } from './database';
import { applyAction, getPlayerByName, getGameState } from './gameService';
import { ExtendedRequest } from './server';

let wss: WebSocketServer;

const playersWsMap = new Map<string, WebSocket>();

export const startWebSocketServer = (
  server: Server,
  sessionMiddleware: any,
) => {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    sessionMiddleware(request, {} as any, () => {
      if ((request as ExtendedRequest).session.username) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });
  });

  setInterval(() => {
    Object.values(getGameState().maps).forEach((map) =>
      Object.values(map.players).forEach((player) => {
        const ws = playersWsMap.get(player.name);

        if (playersWsMap.get(player.name)?.OPEN) {
          ws!.send(JSON.stringify(map));
        }
      }),
    );
  }, 1000 / 60);

  wss.on('connection', (ws: WebSocket, request: any) => {
    const session = (request as ExtendedRequest).session;
    playersWsMap.set(session.username!, ws);

    ws.on('message', async (message: WebSocket.RawData) => {
      try {
        const action: PlayerAction = JSON.parse(message.toString());
        if (session.username) {
          const player = await getPlayerByName(session.username);
          if (player) {
            const map = await getMap(player.mapId);
            if (map) {
              applyAction(map, action, player.name);
            }
          } else {
            ws.send('Player not found');
          }
        } else {
          ws.send('Session not found or player not logged in.');
        }
      } catch (e) {
        console.error('Error parsing message:', e);
        ws.send('Invalid message format');
      }
    });

    ws.on('close', () => {
      console.log('User disconnected', session.username);
    });
  });
};
