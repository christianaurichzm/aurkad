import { Server } from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { removePlayer, getMap, getPlayers } from './database';
import { createPlayer } from './playerService';
import {
  ServerMessage,
  InitMessage,
  MessageType,
  Player,
} from '../shared/types';
import { getGameState, handleAttack, handlePlayerUpdate } from './gameService';

export const initializeWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (message: RawData) => {
      const data: ServerMessage = JSON.parse(message.toString());

      if ('player' in data) {
        if (data.type === MessageType.PLAYER_UPDATE) {
          handlePlayerUpdate(data.player);
        } else if (data.type === MessageType.ATTACK) {
          handleAttack(data.player.id);
        }
        broadcastGameState(wss, data.player);
      }
    });

    ws.on('close', () => {});
  });

  const broadcastGameState = (wss: WebSocketServer, player: Player) => {
    const gameState = getGameState(player.mapId);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(gameState));
      }
    });
  };
};
