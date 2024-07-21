import {
  HttpRequestOptions,
  Player,
  MapState,
  KeyboardAction,
  ClientActionType,
  ClientAction,
} from '../../shared/types';
import { getGameState, setPlayer, updateGameState } from '../core/gameState';

const WS_URL = 'ws://localhost:8080/ws';

let socket: WebSocket;

const messageQueue: { map: MapState; player: Player }[] = [];

export const initializeWebSocket = () => {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('Conectado ao servidor');
  };

  socket.onmessage = (event) => {
    messageQueue.push(JSON.parse(event.data));
  };

  socket.onclose = () => {
    console.log('Desconectado do servidor');
  };

  socket.onerror = (error: any) => {
    console.error('Erro na conexão:', error);
  };
};

export function updateWebSocket(): void {
  while (messageQueue.length > 0) {
    const message = messageQueue.shift();
    if (message) {
      updateGameState(message.map);
      setPlayer(message.player);
    }
  }
}

export function sendAction(action: ClientAction) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(action));
  } else {
    console.error('WebSocket is not open.');
  }
}

export const httpClient = async <T>(
  endpoint: string,
  { method, headers, body }: HttpRequestOptions,
): Promise<T | null> => {
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
      console.error(
        `Error: ${response.status} - ${response.statusText} - ${data}`,
      );
      return null;
    }

    return data as T;
  } catch (error) {
    console.error('HTTP Client Error:', error);
    return null;
  }
};

export const login = async (username: string) => {
  return httpClient<{ player: Player; map: MapState }>('/login', {
    method: 'POST',
    body: { username },
  });
};

export const openMapEditor = async () => {
  return httpClient<Response>('/openMapEditor', {
    method: 'POST',
  });
};

export const saveMap = async (newMapTiles: MapState['tiles']) => {
  const mapData = {
    mapId: getGameState().id,
    tiles: newMapTiles,
  };

  return httpClient<Response>('/saveMap', {
    method: 'POST',
    body: mapData,
  });
};

export const changeSprite = async (spriteId: number) => {
  return httpClient<Response>('/changeSprite', {
    method: 'POST',
    body: { spriteId },
  });
};
