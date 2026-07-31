import { RequestHandler } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import { logger } from '../logger.js';
import {
  ActionQueueItem,
  ClientChatAction,
  ClientCustomAction,
  ClientItemAction,
  ClientKeyboardAction,
  ServerAction,
  ServerActionType,
} from '../engine/actions.js';
import { ClientMessageSchema } from './clientMessage.js';
import { config } from '../config.js';
import type { ExtendedRequest } from '../http/session.js';
import { handleChatAction } from '../services/comms/chatService.js';
import {
  disconnectPlayer,
  handleKeyAction,
  getGameState,
} from '../services/gameService.js';
import { handleItemAction } from '../services/economy/inventoryService.js';
import { handleCustomAction } from '../services/comms/customEventService.js';
import { updateNpcs } from '../services/npc/index.js';
import { gameConfig } from '../gameConfig.js';
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

/**
 * Rate-limiter entries, published as a metric.
 *
 * Keyed by username and removed when the connection closes. Exposed because
 * "removed on close" is a claim about every close path, and the only honest
 * check is watching this against the connection count over a long run.
 */
export function rateLimiterEntryCount(): number {
  return messageRate.size;
}

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
      logger.warn('[ws] action queue full; dropping oldest', {
        dropped: droppedQueuedActions,
        max: maxSize,
      });
      lastQueueDropLogTime = now;
    }
  }

  actionQueue.enqueue(action);
}

function isClientAction(
  action: ActionQueueItem,
): action is
  | ClientKeyboardAction
  | ClientItemAction
  | ClientChatAction
  | ClientCustomAction {
  return 'username' in action;
}

function isServerAction(action: ActionQueueItem): action is ServerAction {
  return 'action' in action;
}

function handleServerAction(action: ServerAction) {
  switch (action.action) {
    case ServerActionType.UpdateNpcPositions:
      Object.values(getGameState().maps).forEach((map) => {
        const livePlayers = Object.values(map.players).filter(
          (player) => player.health > 0,
        );
        Object.values(map.npcs).forEach((npc) => {
          updateNpcs(npc, map, livePlayers);
        });
      });
      break;
    case ServerActionType.RegeneratePlayersHP:
      Object.values(getGameState().maps).forEach((map) => {
        Object.values(map.players).forEach((player) => {
          if (player.health < player.maxHealth) {
            const { regenPercent, minRegen } = gameConfig.combat;
            const regenAmount = Math.max(
              Math.floor(player.maxHealth * regenPercent),
              minRegen,
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
        } else if (action.type === 'custom') {
          handleCustomAction(action);
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
        } catch {
          // socket already dead; nothing to clean up
        }
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
        if (isRateLimited(username)) return;

        let raw: unknown;
        try {
          // `ws` hands over a Buffer for a whole frame but an array of them
          // for a fragmented one, whose toString() joins with commas and would
          // turn every fragmented message into garbage.
          const bytes = Buffer.isBuffer(message)
            ? message
            : Array.isArray(message)
              ? Buffer.concat(message.map((part) => new Uint8Array(part)))
              : Buffer.from(message);
          raw = JSON.parse(bytes.toString('utf8'));
        } catch {
          return;
        }

        const result = ClientMessageSchema.safeParse(raw);
        if (!result.success) return;

        enqueueAction({ username, ...result.data });
      });

      ws.on('close', () => {
        if (!shuttingDown) {
          disconnectPlayer(username).catch((e) => {
            logger.error('disconnectPlayer failed', { err: e });
          });
        }
        playersWsMap.delete(username);
        messageRate.delete(username);
      });

      ws.on('error', (err) => {
        logger.error('[ws] connection error', { username, err });
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
    } catch {
      // already closing; ignore
    }
  }

  playersWsMap.clear();

  await new Promise<void>((resolve) => {
    if (!wss) return resolve();
    wss.close(() => resolve());
  });
}

export function getActionQueueSize(): number {
  return actionQueue.size;
}

export function markServerShuttingDown() {
  shuttingDown = true;
}

export function enqueueServerAction(action: ServerActionType) {
  enqueueAction({ action });
}
