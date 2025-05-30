import {
  ClientAction,
  ClientChatAction,
  ChatScope,
  MapStateClient,
  Player,
  Access,
  HttpRequestOptions,
  Item,
  ProductDetailed,
  ProductRaw,
  RuntimeNpc,
  Shop,
  GameState,
  MapType,
} from '../../shared/types';
import {
  getGameState,
  getPlayer,
  patchGameState,
  setFullGameState,
} from '../core/gameState';
import { hideConnectionStatus, showConnectionStatus } from '../graphics/hud';
import { onServerPositionUpdate } from '../graphics/render';
import { displayChatMessage } from '../components/ChatPanel';

const API_URL = import.meta.env.VITE_APP_API_URL;
const REST_PROTO = import.meta.env.VITE_REST_PROTOCOL;

const clientWsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

const clientHost = window.location.host;

export const WS_URL = `${clientWsProtocol}://${clientHost}/ws`;

let socket: WebSocket;
let reconnectAttempts = 0;

const gameStateQueue: any[] = [];
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

      switch (data.type) {
        case 'chat':
          chatQueue.push(data);
          break;
        case 'kick':
          alert(data.message || 'You have been kicked from the game.');
          window.location.reload();
          break;
        case 'openShop':
          if (data.shopId) {
            window.dispatchEvent(
              new CustomEvent<string>('open-shop', { detail: data.shopId }),
            );
          }
          break;
        case 'fullGameState':
        case 'gameStateDelta':
          gameStateQueue.push(data);
          break;
        default:
          if (data.map && data.player) {
            console.warn(
              'Received legacy game state format. Treating as full update.',
            );
            gameStateQueue.push({ type: 'fullGameState', payload: data });
          } else {
            console.warn('Received unknown WebSocket message type:', data.type);
          }
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

    if (!message?.payload) continue;

    const previousPlayer = structuredClone(getPlayer());

    if (message.type === 'fullGameState') {
      setFullGameState(message.payload);
    } else if (message.type === 'gameStateDelta') {
      patchGameState(message.payload);
    }

    const currentPlayer = getPlayer();

    if (previousPlayer && currentPlayer) {
      const moved =
        previousPlayer.position.x !== currentPlayer.position.x ||
        previousPlayer.position.y !== currentPlayer.position.y;

      if (moved) {
        onServerPositionUpdate(
          currentPlayer.id,
          previousPlayer.position,
          currentPlayer.position,
        );
      }
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

export function sendAction(action: ClientAction): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(action));
  } else {
    console.warn('WebSocket not open. Action skipped:', action.type);
  }
}

export async function loadImageFromBin(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const data = new Uint8Array(buffer);

  for (let i = 0; i < data.length; i++) {
    data[i] ^= 0xa5;
  }

  const blob = new Blob([data], { type: 'image/png' });
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}

export const httpClient = async <T>(
  endpoint: string,
  { method, headers, body }: HttpRequestOptions,
): Promise<T | null> => {
  const response = await fetch(`${REST_PROTO}://${API_URL}${endpoint}`, {
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
};

export const login = async (username: string, password: string) => {
  return await httpClient<{ player: Player; map: MapStateClient }>('/login', {
    method: 'POST',
    body: { username, password },
  });
};

export const register = async (username: string, password: string) => {
  return await httpClient<{ success: boolean }>('/register', {
    method: 'POST',
    body: { username, password },
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

export async function openContentEditor(): Promise<boolean> {
  const res = await silentAction(
    httpClient('/openContentEditor', { method: 'POST' }),
  );
  return !!res;
}

export const saveMap = async (
  newMapTiles: MapStateClient['tiles'],
  name: string,
  type: MapType,
) => {
  const mapData = {
    mapId: getGameState()?.id,
    tiles: newMapTiles,
    name,
    type,
  };

  return httpClient<Response>('/saveMap', {
    method: 'POST',
    body: mapData,
  });
};

export const fetchNpcs = async (): Promise<RuntimeNpc[]> => {
  return (await httpClient<RuntimeNpc[]>('/npcs', { method: 'GET' })) || [];
};

export const fetchItems = async (): Promise<Item[]> => {
  return (await httpClient<Item[]>('/items', { method: 'GET' })) || [];
};

export const fetchMaps = async (): Promise<MapStateClient[]> => {
  return (await httpClient<MapStateClient[]>('/maps', { method: 'GET' })) || [];
};

export const assignPointsPlayer = async (
  id: string,
  attack: number,
  vitality: number,
): Promise<void> => {
  await httpClient(`/players/${id}/assignPoints`, {
    method: 'POST',
    body: { attack, vitality },
  });
};

export const fetchShops = async (): Promise<Shop<ProductRaw>[]> => {
  const result = await httpClient<Shop<ProductRaw>[]>('/shops', {
    method: 'GET',
  });
  return Array.isArray(result) ? result : [];
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

export const createNpc = async (
  npc: Pick<
    RuntimeNpc,
    'name' | 'sprite' | 'maxHealth' | 'attack' | 'behavior' | 'experienceValue'
  >,
): Promise<RuntimeNpc | null> => {
  return httpClient<RuntimeNpc>('/npcs', {
    method: 'POST',
    body: npc,
  });
};

export const updateNpc = async (
  id: string,
  npc: Partial<RuntimeNpc>,
): Promise<RuntimeNpc | null> => {
  return httpClient<RuntimeNpc>(`/npcs/${id}`, {
    method: 'PUT',
    body: npc,
  });
};

export const updateMap = async (
  id: string,
  map: Partial<MapStateClient>,
): Promise<MapStateClient | null> => {
  return httpClient<MapStateClient>(`/maps/${id}`, {
    method: 'PUT',
    body: map,
  });
};

export const createMap = async (data: {
  name: string;
  type: MapType;
}): Promise<MapStateClient | null> => {
  return httpClient<MapStateClient>(`/maps`, {
    method: 'POST',
    body: data,
  });
};

export const deleteNpc = async (id: string): Promise<void> => {
  await httpClient(`/npcs/${id}`, {
    method: 'DELETE',
  });
};

export const createItem = async (
  item: Omit<Item, 'id'>,
): Promise<Item | null> => {
  return httpClient<Item>('/items', {
    method: 'POST',
    body: item,
  });
};

export const updateItem = async (
  id: number,
  item: Partial<Item>,
): Promise<Item | null> => {
  return httpClient<Item>(`/items/${id}`, {
    method: 'PUT',
    body: item,
  });
};

export const deleteItem = async (id: number): Promise<void> => {
  await httpClient(`/items/${id}`, {
    method: 'DELETE',
  });
};

export const fetchShop = async (
  shopId: string,
): Promise<Shop<ProductDetailed> | null> => {
  return httpClient<Shop<ProductDetailed>>(`/shop/${shopId}`, {
    method: 'GET',
  });
};

export const fetchMap = async (
  mapId: string,
): Promise<MapStateClient | null> => {
  return httpClient<MapStateClient>(`/maps/${mapId}`, {
    method: 'GET',
  });
};

export const buyShopItem = async (
  shopId: string,
  itemId: number,
): Promise<{ success: boolean; message?: string } | null> => {
  return httpClient<{ success: boolean; message?: string }>('/shop/buy', {
    method: 'POST',
    body: { shopId, itemId },
  });
};
