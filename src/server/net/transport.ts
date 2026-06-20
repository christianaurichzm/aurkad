import { RequestHandler } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import { Key } from '../../shared/types.js';
import {
  ActionQueueItem,
  ClientChatAction,
  ClientItemAction,
  ClientKeyboardAction,
  ServerAction,
  ServerActionType,
} from '../engine/actions.js';
import { config } from '../config.js';
import type { ExtendedRequest } from '../http/session.js';
import { handleChatAction } from '../services/chatService.js';
import {
  disconnectPlayer,
  handleKeyAction,
  getGameState,
} from '../services/gameService.js';
import { handleItemAction } from '../services/inventoryService.js';
import { updateNpcs } from '../services/npcService.js';
import { REGEN_PERCENT, MIN_REGEN } from '../../shared/constants.js';
import { playersWsMap } from './connections.js';

type IntervalHandle = ReturnType<typeof setInterval>;
type AliveWebSocket = WebSocket & { isAlive?: boolean };

type RateState = {
  windowStartMs: number;
  count: number;
  dropped: number;
};

class FastQueue<T> {
  private items: T[] = [];
  private head = 0;

  enqueue(item: T) {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    if (this.head >= this.items.length) return undefined;
    const item = this.items[this.head];
    this.head++;

    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }

    return item;
  }

  get size() {
    return this.items.length - this.head;
  }

  clear() {
    this.items = [];
    this.head = 0;
  }
}

let wss: WebSocketServer;
let shuttingDown = false;
let heartbeatInterval: IntervalHandle | undefined;

const actionQueue = new FastQueue<ActionQueueItem>();
let droppedQueuedActions = 0;
let lastQueueDropLogTime = 0;

const messageRate = new Map<string, RateState>();

function isRateLimited(username: string): boolean {
  const limit = config.limits.wsMaxMessagesPerSecond;
  if (limit <= 0) return false;

  const now = Date.now();
  const state = messageRate.get(username);

  if (!state || now - state.windowStartMs >= 1000) {
    messageRate.set(username, { windowStartMs: now, count: 1, dropped: 0 });
    return false;
  }

  state.count++;
  if (state.count > limit) {
    state.dropped++;
    return true;
  }

  return false;
}

function applyDroppedRelease(action: ActionQueueItem | undefined) {
  if (
    action &&
    'type' in action &&
    action.type === 'keyboard' &&
    action.keyboardAction.type === 'release'
  ) {
    handleKeyAction(action);
  }
}

function enqueueAction(action: ActionQueueItem) {
  const maxSize = config.limits.actionQueueMaxSize;
  if (maxSize > 0 && actionQueue.size >= maxSize) {
    applyDroppedRelease(actionQueue.dequeue());
    droppedQueuedActions++;

    const now = Date.now();
    if (now - lastQueueDropLogTime > 5000) {
      console.warn(
        `[ws] action queue full; dropping oldest (dropped=${droppedQueuedActions}, max=${maxSize})`,
      );
      lastQueueDropLogTime = now;
    }
  }

  actionQueue.enqueue(action);
}

function isClientAction(
  action: ActionQueueItem,
): action is ClientKeyboardAction | ClientItemAction | ClientChatAction {
  return 'username' in action;
}

function isServerAction(action: ActionQueueItem): action is ServerAction {
  return 'action' in action;
}

function handleServerAction(action: ServerAction) {
  switch (action.action) {
    case ServerActionType.UpdateNpcPositions:
      Object.values(getGameState().maps).forEach((map) => {
        Object.values(map.npcs).forEach((npc) => {
          updateNpcs(npc, map);
        });
      });
      break;
    case ServerActionType.RegeneratePlayersHP:
      Object.values(getGameState().maps).forEach((map) => {
        Object.values(map.players).forEach((player) => {
          if (player.health < player.maxHealth) {
            const regenAmount = Math.max(
              Math.floor(player.maxHealth * REGEN_PERCENT),
              MIN_REGEN,
            );
            player.health = Math.min(
              player.health + regenAmount,
              player.maxHealth,
            );
          }
        });
      });
      break;
  }
}

export function processActions() {
  while (actionQueue.size > 0) {
    const action = actionQueue.dequeue();

    if (action) {
      if (isClientAction(action)) {
        if (action.type === 'keyboard') {
          handleKeyAction(action);
        } else if (action.type === 'item') {
          handleItemAction(action);
        } else if (action.type === 'chat') {
          handleChatAction(action);
        }
      } else if (isServerAction(action)) {
        handleServerAction(action);
      }
    }
  }
}

export const startWebSocketServer = (
  server: Server,
  sessionMiddleware: RequestHandler,
) => {
  shuttingDown = false;
  wss = new WebSocketServer({
    noServer: true,
    path: '/ws',
    maxPayload: config.ws.maxPayloadBytes,
  });

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(() => {
    for (const [username, ws] of playersWsMap) {
      const aliveWs = ws as AliveWebSocket;
      if (aliveWs.isAlive === false) {
        try {
          ws.terminate();
        } catch {}
        playersWsMap.delete(username);
        continue;
      }

      aliveWs.isAlive = false;
      try {
        ws.ping();
      } catch {
        playersWsMap.delete(username);
      }
    }
  }, config.ws.heartbeatIntervalMs);

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') {
      socket.destroy();
      return;
    }

    sessionMiddleware(request as ExtendedRequest, {} as any, () => {
      if ((request as ExtendedRequest).session.username) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });
  });

  wss.on('connection', (ws: WebSocket, request: ExtendedRequest) => {
    const username = request.session.username;
    if (username) {
      const aliveWs = ws as AliveWebSocket;
      aliveWs.isAlive = true;
      ws.on('pong', () => {
        aliveWs.isAlive = true;
      });

      const existingWs = playersWsMap.get(username);
      if (existingWs && existingWs.readyState === WebSocket.OPEN) {
        existingWs.close(1000, 'New connection established');
      }

      playersWsMap.set(username, ws);

      ws.on('message', (message, isBinary) => {
        if (isBinary) return;

        if (isRateLimited(username)) {
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(message.toString());
        } catch {
          return;
        }

        if (!parsed || typeof parsed !== 'object') return;

        const clientAction = parsed as Record<string, unknown>;
        const type = clientAction.type;
        if (typeof type !== 'string') return;

        switch (type) {
          case 'keyboard': {
            const keyboardActionUnknown = clientAction.keyboardAction;
            if (
              !keyboardActionUnknown ||
              typeof keyboardActionUnknown !== 'object'
            ) {
              return;
            }

            const keyboardAction = keyboardActionUnknown as Record<
              string,
              unknown
            >;
            const actionType = keyboardAction.type;
            const key = keyboardAction.key;

            if (
              (actionType !== 'press' && actionType !== 'release') ||
              typeof key !== 'string' ||
              !Object.values(Key).includes(key as Key)
            ) {
              return;
            }

            const seq =
              typeof clientAction.seq === 'number'
                ? clientAction.seq
                : undefined;
            enqueueAction({
              username,
              type: 'keyboard',
              keyboardAction: {
                key: key as Key,
                type: actionType,
              },
              seq,
            });
            break;
          }

          case 'item':
            if (typeof clientAction.item !== 'number') {
              return;
            }
            if (
              clientAction.action !== 'use' &&
              clientAction.action !== 'drop'
            ) {
              return;
            }
            enqueueAction({
              username,
              type: 'item',
              item: clientAction.item,
              action: clientAction.action,
            });
            break;

          case 'chat':
            if (typeof clientAction.message !== 'string') {
              return;
            }
            if (
              clientAction.scope !== 'player' &&
              clientAction.scope !== 'map' &&
              clientAction.scope !== 'global'
            ) {
              return;
            }
            enqueueAction({
              username,
              type: 'chat',
              message: clientAction.message,
              scope: clientAction.scope,
            });
            break;
        }
      });

      ws.on('close', () => {
        if (!shuttingDown) {
          disconnectPlayer(username).catch((e) => {
            console.error('disconnectPlayer failed:', e);
          });
        }
        playersWsMap.delete(username);
        messageRate.delete(username);
      });

      ws.on('error', (err) => {
        console.error(`[ws] error for ${username}:`, err);
        playersWsMap.delete(username);
        messageRate.delete(username);
      });
    }
  });
};

export async function stopWebSocketServer(): Promise<void> {
  shuttingDown = true;
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = undefined;
  }

  for (const ws of playersWsMap.values()) {
    try {
      ws.close(1001, 'Server shutting down');
    } catch {}
  }

  playersWsMap.clear();

  await new Promise<void>((resolve) => {
    if (!wss) return resolve();
    wss.close(() => resolve());
  });
}

export function markServerShuttingDown() {
  shuttingDown = true;
}

export function enqueueServerAction(action: ServerActionType) {
  enqueueAction({ action });
}
