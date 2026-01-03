import { RequestHandler } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import {
  Key,
  ChatMessagePayload,
} from '../shared/types.js';
import type {
  FullGameStatePayload,
} from '../shared/wsProtocol.js';
import {
  ActionQueueItem,
  ClientChatAction,
  ClientItemAction,
  ClientKeyboardAction,
  ServerAction,
  ServerActionType,
} from './engine/actions.js';
import { config } from './config.js';
import { getMap } from './gameData.js';
import type { ExtendedRequest } from './http/session.js';
import { drainGameEvents } from './engine/eventBus.js';
import { handleChatAction } from './services/chatService.js';
import {
  disconnectPlayer,
  handleKeyAction,
  getGameState,
  processMovementIntent,
  processMovementCompletion,
} from './services/gameService.js';
import { handleItemAction } from './services/inventoryService.js';
import { updateNpcs } from './services/npcService.js';
import { enrichPlayer, getPlayerByName } from './services/playerService.js';
import { toMapStateClient } from './engine/serialization.js';
import * as jsondiffpatch from 'jsondiffpatch';
import { REGEN_PERCENT, MIN_REGEN, TILE_SIZE } from '../shared/constants.js';
import { rebuildQuadtree } from './spatial/SpatialManager.js';

let wss: WebSocketServer;
let shuttingDown = false;

export const playersWsMap = new Map<string, WebSocket>();

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;
type AliveWebSocket = WebSocket & { isAlive?: boolean };

let heartbeatInterval: IntervalHandle | undefined;

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

const diffPatcher = jsondiffpatch.create({
  objectHash: (obj: any, index?: number): string | undefined => {
    return obj.id || obj.name || `$$index:${index}`;
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
});

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

            enqueueAction({
              username,
              type: 'keyboard',
              keyboardAction: {
                key: key as Key,
                type: actionType,
              },
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

const actionQueue = new FastQueue<ActionQueueItem>();
let droppedQueuedActions = 0;
let lastQueueDropLogTime = 0;

type RateState = {
  windowStartMs: number;
  count: number;
  dropped: number;
};

const messageRate = new Map<string, RateState>();

function enqueueAction(action: ActionQueueItem) {
  const maxSize = config.limits.actionQueueMaxSize;
  if (maxSize > 0 && actionQueue.size >= maxSize) {
    actionQueue.dequeue();
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

export async function processActions() {
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

export function startGameLoops(): () => void {
  const TICK_RATE = config.gameLoop.tickRate;
  const MAX_UPDATES_PER_TICK = config.gameLoop.maxUpdatesPerTick;

  const tickInterval = 1000 / TICK_RATE;
  let lastUpdateTime = Date.now();

  let running = true;
  let tickTimeout: TimeoutHandle | undefined;

  const rebuildSpatialIndexes = () => {
    try {
      const state = getGameState();
      if (!state || !state.maps) return;

      for (const [mapId, map] of Object.entries(state.maps)) {
        if (map && map.players && map.npcs) {
          rebuildQuadtree(mapId, map);
        }
      }
    } catch (err) {
      console.error('[spatial] Failed to rebuild quadtree:', err);
    }
  };

  const tickSystems: Array<{ name: string; run: () => unknown }> = [
    { name: 'rebuildSpatialIndexes', run: () => rebuildSpatialIndexes() },
    { name: 'processActions', run: () => processActions() },
    { name: 'processMovementIntent', run: () => processMovementIntent() },
    {
      name: 'processMovementCompletion',
      run: () => processMovementCompletion(),
    },
    { name: 'flushGameEvents', run: () => flushGameEvents() },
    { name: 'broadcastGameState', run: () => broadcastGameState() },
  ];

  const runTickSystems = () => {
    for (const system of tickSystems) {
      try {
        const result = system.run();
        if (result instanceof Promise) {
          result.catch((e) => {
            console.error(`[tick] system failed: ${system.name}`, e);
          });
        }
      } catch (e) {
        console.error(`[tick] system failed: ${system.name}`, e);
      }
    }
  };

  const tick = () => {
    if (!running) return;
    const now = Date.now();
    let updates = 0;

    while (
      now - lastUpdateTime >= tickInterval &&
      updates < MAX_UPDATES_PER_TICK
    ) {
      runTickSystems();
      lastUpdateTime += tickInterval;
      updates++;
    }

    const delay = Math.max(0, tickInterval - (Date.now() - lastUpdateTime));
    tickTimeout = setTimeout(tick, delay);
  };

  tick();

  const npcInterval = setInterval(() => {
    enqueueAction({ action: ServerActionType.UpdateNpcPositions });
  }, 1250);

  const regenInterval = setInterval(() => {
    enqueueAction({ action: ServerActionType.RegeneratePlayersHP });
  }, 5000);

  return () => {
    running = false;
    if (tickTimeout) clearTimeout(tickTimeout);
    clearInterval(npcInterval);
    clearInterval(regenInterval);
  };
}

export function broadcastChat(message: ChatMessagePayload) {
  const data = JSON.stringify(message);

  playersWsMap.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function flushGameEvents() {
  const events = drainGameEvents();
  if (events.length === 0) return;

  for (const event of events) {
    switch (event.type) {
      case 'openShop': {
        const ws = playersWsMap.get(event.username);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'openShop', shopId: event.shopId }));
        }
        break;
      }
      case 'chatGlobal':
        broadcastChat(event.payload);
        break;
      case 'chatMap':
        broadcastMapChat(event.senderUsername, event.payload);
        break;
      case 'chatMapId':
        broadcastToMap(event.mapId, event.payload);
        break;
    }
  }
}

export function broadcastMapChat(
  senderUsername: string,
  message: ChatMessagePayload,
) {
  const player = getPlayerByName(senderUsername);

  const map = getMap(player?.mapId);

  Object.values(map?.players ?? {}).forEach((player) => {
    const ws = playersWsMap.get(player.name);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

export function broadcastToMap(mapId: string, message: ChatMessagePayload) {
  const map = getMap(mapId);
  if (!map) return;

  Object.values(map.players).forEach((player) => {
    const ws = playersWsMap.get(player.name);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
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

export const lastSentStates = new Map<string, FullGameStatePayload>();

function broadcastGameState() {
  const gameState = getGameState();
  const interestRadiusPx = config.net.interestRadiusTiles * TILE_SIZE;

  for (const map of Object.values(gameState.maps)) {
    for (const player of Object.values(map.players)) {
      const ws = playersWsMap.get(player.name);

      if (ws?.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        const enrichedPlayer = enrichPlayer(player);
        const currentState: FullGameStatePayload = structuredClone({
          map: toMapStateClient(map, player, interestRadiusPx),
          player: enrichedPlayer,
        });

        const lastState = lastSentStates.get(player.name);
        let message: { type: string; payload: any } | null = null;

        if (!lastState) {
          message = { type: 'fullGameState', payload: currentState };
        } else {
          const delta = diffPatcher.diff(lastState, currentState);
          if (delta) {
            message = { type: 'gameStateDelta', payload: delta };
          }
        }

        if (message) {
          ws.send(JSON.stringify(message));
          lastSentStates.set(player.name, currentState);
        }
      } catch (error) {
        console.error(`Error broadcasting to ${player.name}:`, error);
      }
    }
  }
}

export { broadcastGameState as broadcast };
