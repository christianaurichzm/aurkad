import {
  PROTOCOL_VERSION,
  type WsClientMessage,
  type WsServerMessage,
} from '../../../shared/wsProtocol';
import { hideConnectionStatus, showConnectionStatus } from '../../graphics/hud';
import { useUIStore } from '../../stores/uiStore';
import { enqueueGameStateMessage } from './sync/gameStateSync';
import { enqueueChatMessage, setChatSocketSender } from './sync/chatSync';
import { dispatchServerEvent } from './customEvents';

const clientWsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const clientHost = window.location.host;

const DEFAULT_WS_URL = `${clientWsProtocol}://${clientHost}/ws`;
export const WS_URL = DEFAULT_WS_URL;

let currentWsUrl = DEFAULT_WS_URL;
let socket: WebSocket;
let reconnectAttempts = 0;
let kicked = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleReconnect = () => {
  if (reconnectTimer !== null) return;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
  console.log(`Trying to reconnect in ${delay / 1000}s`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempts++;
    initializeWebSocket();
  }, delay);
};

let protocolMismatchHandled = false;

function handleProtocolMismatch(serverVersion: number) {
  if (protocolMismatchHandled) return;
  protocolMismatchHandled = true;
  kicked = true; // suppress the reconnect loop; we are about to reload
  console.warn(
    `[Client] Protocol mismatch: server v${serverVersion}, client v${PROTOCOL_VERSION}. Reloading.`,
  );
  void useUIStore
    .getState()
    .showDialog({
      title: 'Update available',
      message:
        'The server was updated while this tab was open. Reload to continue.',
      kind: 'error',
      confirmLabel: 'Reload',
    })
    .finally(() => window.location.reload());
  socket?.close();
}

export const initializeWebSocket = (url = currentWsUrl) => {
  currentWsUrl = url;
  try {
    kicked = false;
    socket = new WebSocket(url);
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

  socket.onmessage = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as WsServerMessage;

      // A versioned message whose version we do not speak means the server was
      // deployed with a new wire format while this tab stayed open. Applying it
      // would corrupt local state silently (audit F-7), so resync by reloading.
      // Read off the raw shape: only the game-state messages carry `v`, and a
      // mismatch is exactly the case where the declared union may be wrong.
      const version = (data as { v?: unknown }).v;
      if (typeof version === 'number' && version !== PROTOCOL_VERSION) {
        handleProtocolMismatch(version);
        return;
      }

      switch (data.type) {
        case 'chat':
          enqueueChatMessage(data);
          break;
        case 'kick':
          kicked = true;
          void useUIStore
            .getState()
            .showDialog({
              title: 'Disconnected',
              message: data.message || 'You have been kicked from the game.',
              kind: 'error',
              confirmLabel: 'Reload',
            })
            .finally(() => window.location.reload());
          socket.close();
          break;
        case 'redirect':
          kicked = true;
          socket.close();
          setTimeout(() => initializeWebSocket(data.url), 200);
          break;
        case 'openShop':
          if (data.shopId) {
            window.dispatchEvent(
              new CustomEvent<string>('open-shop', { detail: data.shopId }),
            );
          }
          break;
        case 'custom':
          if (typeof data.channel === 'string') {
            dispatchServerEvent(data.channel, data.payload);
          }
          break;
        case 'mapMeta':
        case 'mapChunk':
        case 'playerStats':
        case 'worldUpdate':
          enqueueGameStateMessage(data);
          break;
      }
    } catch (err) {
      console.error('[Client] WebSocket message error:', err);
    }
  };

  socket.onclose = () => {
    console.warn('WebSocket closed');
    if (kicked) return;
    showConnectionStatus('Disconnected. Reconnecting...', true);
    scheduleReconnect();
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    socket.close();
  };

  setChatSocketSender(sendAction);
};

export function sendAction(action: WsClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(action));
  } else {
    console.warn('WebSocket not open. Action skipped:', action.type);
  }
}

window.addEventListener('offline', () => {
  showConnectionStatus('You are offline', true);
});

window.addEventListener('online', () => {
  showConnectionStatus('Back online. Reconnecting...', false);
  scheduleReconnect();
});
