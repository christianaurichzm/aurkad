import {
  HttpRequestOptions,
  Player,
  MapState,
  ClientAction,
  ClientChatAction,
  ChatScope,
  Npc,
  Item,
  Access,
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
      } else if (data.type === 'kick') {
        alert(data.message || 'You have been kicked from the game.');
        window.location.reload();
        return;
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
    let data: any;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw {
        status: response.status,
        message:
          data?.message ||
          `Error: ${response.status} - ${response.statusText} - ${data}`,
      };
    }

    return data as T;
  } catch (error) {
    throw error;
  }
};

export const login = async (username: string) => {
  return await httpClient<{ player: Player; map: MapState }>('/login', {
    method: 'POST',
    body: { username },
  });
};

export async function silentAction<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return null;
    }
    throw error;
  }
}

export async function openMapEditor(): Promise<boolean> {
  const res = await silentAction(
    httpClient('/openMapEditor', { method: 'POST' }),
  );
  return !!res;
}

export async function openModEditor(): Promise<boolean> {
  const res = await silentAction(
    httpClient('/openModEditor', { method: 'POST' }),
  );
  return !!res;
}

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

export const fetchNpcs = async (): Promise<Npc[]> => {
  return (await httpClient<Npc[]>('/npcs', { method: 'GET' })) || [];
};

export const fetchItems = async (): Promise<Item[]> => {
  return (await httpClient<Item[]>('/items', { method: 'GET' })) || [];
};

export const changeSprite = async (spriteId: number) => {
  return httpClient<Response>('/mod/changeSprite', {
    method: 'POST',
    body: { spriteId },
  });
};

export const modKick = async (playerName: string) =>
  httpClient<Response>('/mod/kick', {
    method: 'POST',
    body: { playerName },
  });

export const modBan = async (
  playerName: string,
  reason = '',
  until?: number,
) => {
  return httpClient<Response>('/mod/ban', {
    method: 'POST',
    body: { playerName, reason, until },
  });
};

export const modBring = async (playerName: string) =>
  httpClient<Response>('/mod/bring', {
    method: 'POST',
    body: { playerName },
  });

export const modGoto = async (playerName: string) =>
  httpClient<Response>('/mod/goto', {
    method: 'POST',
    body: { playerName },
  });

export const modSetAccess = async (playerName: string, accessLevel: Access) =>
  httpClient<Response>('/mod/setAccess', {
    method: 'POST',
    body: { playerName, accessLevel },
  });

export const modSetSprite = async (playerName: string, spriteId: number) =>
  httpClient<Response>('/mod/setSprite', {
    method: 'POST',
    body: { playerName, spriteId },
  });

export const modMoveMap = async (mapId: string) =>
  httpClient<Response>('/mod/gomap', {
    method: 'POST',
    body: { mapId },
  });

export const modSetMyAccess = async (accessLevel: Access) =>
  httpClient<Response>('/mod/setMyAccess', {
    method: 'POST',
    body: { accessLevel },
  });
