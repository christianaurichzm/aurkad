import type { WsClientMessage, FullGameStatePayload } from '../../../shared/wsProtocol';
import { hideConnectionStatus, showConnectionStatus } from '../../graphics/hud';
import { enqueueGameStateMessage } from './sync/gameStateSync';
import { enqueueChatMessage, setChatSocketSender } from './sync/chatSync';

const clientWsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const clientHost = window.location.host;

export const WS_URL = `${clientWsProtocol}://${clientHost}/ws`;

let socket: WebSocket;
let reconnectAttempts = 0;

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
          enqueueChatMessage(data);
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
          enqueueGameStateMessage(data);
          break;
        default:
          if (data.map && data.player) {
            enqueueGameStateMessage({
              type: 'fullGameState',
              payload: data as FullGameStatePayload,
            });
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
