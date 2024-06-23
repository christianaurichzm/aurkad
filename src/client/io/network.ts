import {
  AttackMessage,
  GameMap,
  HttpRequestOptions,
  InitMessage,
  MessageType,
  Player,
  PlayerUpdateMessage,
  ServerMessage,
} from '../../shared/types';
import { updateGameState } from '../core/gameState';

const API_URL = 'http://localhost:8080';
const WS_URL = 'ws://localhost:8080';

let socket: WebSocket | null = null;
const messageQueue: ServerMessage[] = [];

export const initializeWebSocket = (playerId: string): WebSocket => {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    sendPlayerMessage({ type: MessageType.INIT, playerId } as InitMessage);
  };

  socket.onmessage = (event: MessageEvent) => {
    const data: ServerMessage = JSON.parse(event.data);
    messageQueue.push(data);
  };

  socket.onclose = () => {
    console.log('Disconnected from WebSocket server');
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  processMessageQueue();

  return socket;
};

const processMessageQueue = () => {
  setInterval(() => {
    while (messageQueue.length > 0) {
      const data = messageQueue.shift();
      if (data && data.type === MessageType.GAME_STATE) {
        updateGameState(data.map, null);
      }
    }
  }, 50); // Processar a fila a cada 50ms
};

export const sendPlayerMessage = (
  message: PlayerUpdateMessage | AttackMessage | InitMessage,
) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    console.error('WebSocket is not open. Ready state:', socket?.readyState);
  }
};

export const httpClient = async <T>(
  endpoint: string,
  { method, headers, body }: HttpRequestOptions,
): Promise<T> => {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error('Network response was not ok');
  }

  const data = await response.json();
  return data;
};

export const login = async (username: string) => {
  return httpClient<{ playerId: Player['id']; map: GameMap }>('/login', {
    method: 'POST',
    body: { username },
  });
};
