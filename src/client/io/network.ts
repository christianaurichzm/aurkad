import {
  HttpRequestOptions,
  Player,
  MapState,
  ClientAction,
  ClientChatAction,
  ChatScope,
  Npc,
  Item,
} from '../../shared/types';
import { getGameState, setPlayer, updateGameState } from '../core/gameState';
import { hideConnectionStatus, showConnectionStatus } from '../ui/hud';
import { displayChatMessage } from '../ui/chat';
import { renderInventory } from '../graphics/inventory';

const WS_URL = 'ws://localhost:8080/ws';

let socket: WebSocket;
let reconnectAttempts = 0;

const gameStateQueue: { map: MapState; player: Player }[] = [];
const chatQueue: ClientChatAction[] = [];

const scheduleReconnect = () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
  console.log(`Trying to reconnect in ${delay / 1000}s`);

  setTimeout(() => {
    reconnectAttempts++;
    initializeWebSocket();
  }, delay);
};

export const initializeWebSocket = () => {
  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    console.error('Failed to create WebSocket:', err);
    scheduleReconnect();
    return;
  }

  showConnectionStatus('Connecting...', true);

  socket.onopen = () => {
    console.log('Connected to WebSocket server');
    reconnectAttempts = 0;
    showConnectionStatus('Connected');
    setTimeout(hideConnectionStatus, 2000);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'chat') {
        chatQueue.push(data);
      } else if (data.map && data.player) {
        gameStateQueue.push(data);
      }
    } catch (err) {
      console.error('[Client] WebSocket message error:', err);
    }
  };

  socket.onclose = () => {
    console.warn('WebSocket closed');
    showConnectionStatus('Disconnected. Reconnecting...', true);
    scheduleReconnect();
  };

  socket.onerror = (error: any) => {
    console.error('WebSocket error:', error);
    socket.close();
  };
};

window.addEventListener('offline', () => {
  showConnectionStatus('You are offline', true);
});

window.addEventListener('online', () => {
  showConnectionStatus('Back online. Reconnecting...', false);
  scheduleReconnect();
});

export function updateWebSocket(): void {
  while (gameStateQueue.length > 0) {
    const message = gameStateQueue.shift();

    if (message) {
      updateGameState(message.map);
      setPlayer(message.player);
      renderInventory(message.player);
    }
  }
}

export function updateChat(): void {
  while (chatQueue.length > 0) {
    const message = chatQueue.shift();
    if (message) {
      displayChatMessage(message);
    }
  }
}

export function sendChatMessage() {
  const input = document.getElementById('chatInput') as HTMLInputElement;
  const scope = (document.getElementById('chatScope') as HTMLSelectElement)
    .value as ChatScope;
  const message = input.value.trim();

  if (!message) return;

  const action: ClientChatAction = {
    type: 'chat',
    username: '',
    scope,
    message,
  };

  sendAction(action);
  input.value = '';
}

export function sendAction(action: ClientAction): Promise<void> {
  return new Promise((resolve) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(action));
    } else {
      console.warn('WebSocket not open. Action skipped.');
    }
    resolve();
  });
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

export const fetchNpcs = async (): Promise<Npc[]> => {
  return (await httpClient<Npc[]>('/npcs', { method: 'GET' })) || [];
};

export const fetchItems = async (): Promise<Item[]> => {
  return (await httpClient<Item[]>('/items', { method: 'GET' })) || [];
};
