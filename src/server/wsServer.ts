import { Server } from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { addPlayer, removePlayer, getPlayers, getEnemies } from './database';
import { handlePlayerUpdate, handleAttack, getGameState } from './gameService';
import { createPlayer } from './playerService';
import { ServerMessage, InitMessage, MessageType } from '../shared/types';

export const initializeWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    const newPlayer = createPlayer();
    addPlayer(newPlayer);

    ws.on('message', (message: RawData) => {
      const data: ServerMessage = JSON.parse(message.toString());

      if (data.type === MessageType.PLAYER_UPDATE && 'player' in data) {
        handlePlayerUpdate(data.player);
        broadcastGameState(wss);
      } else if (data.type === MessageType.ATTACK && 'player' in data) {
        handleAttack(data.player.id);
        broadcastGameState(wss);
      }
    });

    ws.on('close', () => {
      removePlayer(newPlayer.id);
      broadcastGameState(wss);
    });

    const initMessage: InitMessage = {
      type: MessageType.INIT,
      playerId: newPlayer.id,
      players: getPlayers(),
      enemies: getEnemies()
    };
    ws.send(JSON.stringify(initMessage));
  });

  const broadcastGameState = (wss: WebSocketServer) => {
    const gameState = getGameState();
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(gameState));
      }
    });
  };
};
