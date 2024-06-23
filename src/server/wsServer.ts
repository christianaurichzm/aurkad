import { Server } from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { removePlayer, getMap, getPlayers, getPlayer } from './database';
import { createPlayer } from './playerService';
import { ServerMessage, MessageType, Player } from '../shared/types';
import {
  disconnectPlayer,
  getGameState,
  handleAttack,
  handlePlayerUpdate,
} from './gameService';

export const initializeWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server });
  const playerConnections = new Map<WebSocket, string>();
  const messageQueue = new Map<WebSocket, ServerMessage[]>();

  wss.on('connection', (ws: WebSocket) => {
    ws.once('message', (message: RawData) => {
      const data: ServerMessage = JSON.parse(message.toString());
      if (data.type === MessageType.INIT && data.playerId) {
        const player = getPlayer(data.playerId);
        if (player) {
          playerConnections.set(ws, player.id);
          messageQueue.set(ws, []);
          broadcastGameState(wss);
        }
      }

      ws.on('message', (message: RawData) => {
        const data: ServerMessage = JSON.parse(message.toString());
        const queue = messageQueue.get(ws);
        if (queue) {
          queue.push(data);
        }
      });

      ws.on('close', () => {
        const playerId = playerConnections.get(ws);
        if (playerId) {
          disconnectPlayer(playerId);
          playerConnections.delete(ws);
          messageQueue.delete(ws);
          broadcastGameState(wss);
        }
      });
    });
  });

  const processMessageQueue = () => {
    messageQueue.forEach((queue, ws) => {
      while (queue.length > 0) {
        const data = queue.shift();
        if (data) {
          if (data.type === MessageType.PLAYER_UPDATE) {
            handlePlayerUpdate(data.player);
          } else if (data.type === MessageType.ATTACK) {
            const playerId = playerConnections.get(ws);
            if (playerId) {
              handleAttack(playerId);
            }
          }
        }
      }
      broadcastGameState(wss);
    });
  };

  setInterval(processMessageQueue, 50); // Processar a fila a cada 50ms

  const broadcastGameState = (wss: WebSocketServer) => {
    wss.clients.forEach((client: WebSocket) => {
      const playerId = playerConnections.get(client);
      if (playerId) {
        const player = getPlayer(playerId);
        if (player) {
          sendGameStateToClient(client, player.mapId);
        }
      }
    });
  };

  const sendGameStateToClient = (client: WebSocket, mapId: string) => {
    const gameState = getGameState(mapId);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(gameState));
    }
  };
};
