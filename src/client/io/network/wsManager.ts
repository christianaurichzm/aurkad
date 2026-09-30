import {
  PROTOCOL_VERSION,
  type WsClientMessage,
  type WsServerMessage,
} from '../../../shared/wsProtocol';
import { hideConnectionStatus, showConnectionStatus } from '../../graphics/hud';
import { useUIStore } from '../../stores/uiStore';
import {
  enqueueGameStateMessage,
  startOverOnNewSocket,
} from './sync/gameStateSync';
import { enqueueChatMessage, setChatSocketSender } from './sync/chatSync';
import { dispatchServerEvent } from './customEvents';
import { getLanguage, onLanguageChange, t } from '../../i18n';

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

  showConnectionStatus(t('net.connecting'), true);

  socket.onopen = () => {
    console.log('Connected to WebSocket server');
    reconnectAttempts = 0;
    startOverOnNewSocket();
    showConnectionStatus(t('net.connected'));
    setTimeout(hideConnectionStatus, 2000);
    // On every open: the server keeps this on the session, so a reconnect or a
    // cross-map warp to another instance would answer in English until told.
    sendAction({ type: 'language', language: getLanguage() });
    for (const action of beforeOpen.splice(0)) sendAction(action);
  };

  socket.onmessage = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as WsServerMessage;

      // A version we do not speak means a deploy changed the wire format while
      // this tab stayed open; applying it would corrupt local state, so reload.
      // Read off the raw shape: on a mismatch the declared types may be wrong.
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
              title: t('hud.disconnected'),
              message: data.message || t('net.kicked'),
              kind: 'error',
              confirmLabel: t('net.reload'),
            })
            .finally(() => window.location.reload());
          socket.close();
          break;
        case 'redirect': {
          kicked = true;
          socket.close();
          // The other instance's trace rides on the query string, as a browser
          // cannot set WebSocket headers; without it the arrival there looks
          // unrelated to this warp.
          const next = data.traceparent
            ? `${data.url}${data.url.includes('?') ? '&' : '?'}traceparent=${encodeURIComponent(data.traceparent)}`
            : data.url;
          setTimeout(() => initializeWebSocket(next), 200);
          break;
        }
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
    showConnectionStatus(t('net.reconnecting'), true);
    scheduleReconnect();
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    socket.close();
  };

  setChatSocketSender(sendAction);
};

// Modules ask for their state (quest:request) before the socket exists, so
// custom events wait for it to open, or the module stays empty. Moves and
// attacks do not wait: sent late, they are a step the player never meant.
const beforeOpen: WsClientMessage[] = [];

export function sendAction(action: WsClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(action));
  } else if (
    action.type === 'custom' &&
    (!socket || socket.readyState === WebSocket.CONNECTING)
  ) {
    beforeOpen.push(action);
  } else {
    console.warn('WebSocket not open. Action skipped:', action.type);
  }
}

// A switch mid-session, so command replies follow it. A module adding its
// table fires this too before the socket is up; the open sends it then.
onLanguageChange(() => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  sendAction({ type: 'language', language: getLanguage() });
});

window.addEventListener('offline', () => {
  showConnectionStatus(t('net.offline'), true);
});

window.addEventListener('online', () => {
  showConnectionStatus(t('net.backOnline'), false);
  scheduleReconnect();
});
