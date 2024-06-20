import {
  AttackMessage,
  MessageType,
  PlayerUpdateMessage,
  ServerMessage,
} from '../../shared/types';
import { gameLoop } from '../core/game';
import { updateGameState } from '../core/gameState';

export const socket = new WebSocket('ws://localhost:8080');

socket.onopen = () => {
  console.log('Connected to WebSocket server');
};

socket.onmessage = (event: MessageEvent) => {
  const data: ServerMessage = JSON.parse(event.data);

  if (data.type === MessageType.INIT) {
    updateGameState(data.players, data.enemies, data.playerId);
    requestAnimationFrame(gameLoop);
  } else if (data.type === MessageType.GAME_STATE) {
    updateGameState(data.players, data.enemies, null);
  }
};

export const sendPlayerMessage = (
  message: PlayerUpdateMessage | AttackMessage,
) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};
