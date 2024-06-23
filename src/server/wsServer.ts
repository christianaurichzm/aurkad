import { Server } from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { removePlayer, getMap } from './database';
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
    const newPlayer = createPlayer();

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

    ws.on('close', () => {
      removePlayer(newPlayer.id);
      broadcastGameState(wss, newPlayer);
    });

    const initMessage: InitMessage = {
      type: MessageType.INIT,
      playerId: newPlayer.id,
      map: getMap(newPlayer.mapId),
    };
    ws.send(JSON.stringify(initMessage));
  });

  const broadcastGameState = (wss: WebSocketServer, player: Player) => {
    const gameState = getGameState(player);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(gameState));
      }
    });
  };
};
