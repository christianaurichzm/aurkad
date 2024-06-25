import {
  PlayerAction,
  HttpRequestOptions,
  Player,
  MapState,
} from '../../shared/types';
import { updateGameState } from '../core/gameState';

const WS_URL = 'ws://localhost:8080/ws';

let socket: WebSocket;

export const initializeWebSocket = () => {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('Conectado ao servidor');
  };

  socket.onmessage = (event) => {
    updateGameState(JSON.parse(event.data));
  };

  socket.onclose = () => {
    console.log('Desconectado do servidor');
  };

  socket.onerror = (error: any) => {
    console.error('Erro na conexão:', error);
  };
};

export function sendAction(action: PlayerAction) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(action));
  } else {
    console.error('WebSocket is not open.');
  }
}

export const httpClient = async <T>(
  endpoint: string,
  { method, headers, body }: HttpRequestOptions,
): Promise<T> => {
  try {
    const response = await fetch(`${process.env.APP_API_URL}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });

    const contentType = response.headers.get('Content-Type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw new Error(
        `Error: ${response.status} - ${response.statusText} - ${data}`,
      );
    }

    return data as T;
  } catch (error) {
    console.error('HTTP Client Error:', error);
    throw error;
  }
};

export const login = async (username: string) => {
  return httpClient<{ playerId: Player['id']; map: MapState }>('/login', {
    method: 'POST',
    body: { username },
  });
};

export const openMapEditor = async () => {
  return httpClient<Response>('/openMapEditor', {
    method: 'POST',
  });
};
