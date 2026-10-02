import { RequestHandler, Response } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'node:http';
import { logger } from '../logger.js';
import {
  ActionQueueItem,
  ClientAction,
  ServerAction,
  ServerActionType,
} from '../engine/actions.js';
import { ClientMessageSchema } from './clientMessage.js';
import { config } from '../config.js';
import type { ExtendedRequest } from '../http/session.js';
import { handleChatAction } from '../services/comms/chatService.js';
import {
  disconnectPlayer,
  getPlayerByName,
  resumePlayer,
} from '../services/player/playerService.js';
import {
  handleKeyAction,
  handleMoveTo,
} from '../services/world/movementService.js';
import { getRuntimeState } from '../services/world/gameData.js';
import { handleItemAction } from '../services/economy/inventoryService.js';
import { handleCustomAction } from '../services/comms/customEventService.js';
import { updateNpcs } from '../services/npc/index.js';
import { npcMoveTicks } from '../services/npc/types.js';
import { gameConfig } from '../gameConfig.js';
import { playersWsMap } from './connections.js';
import { resetPlayerNetState } from './snapshot.js';
import { parseTraceparent, startSpan } from '../tracing.js';
import { recordAction, recordSession } from '../sim/replayRecorder.js';
import { getTick } from '../sim/clock.js';
import { reqCtx } from '../context.js';

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

function isClientAction(action: ActionQueueItem): action is ClientAction {
  return 'username' in action;
}

function isServerAction(action: ActionQueueItem): action is ServerAction {
  return 'action' in action;
}

function handleServerAction(action: ServerAction) {
  switch (action.action) {
    case ServerActionType.UpdateNpcPositions: {
      // Queued every tick, and each npc answers for itself: speed is per npc
      // (moveIntervalMs), so there is no single cadence to gate on. The check
      // is a modulo per npc per tick; what it guards, the sight query and the
      // path search, is what actually costs.
      const tick = getTick();
      Object.values(getRuntimeState().maps).forEach((map) => {
        const livePlayers = Object.values(map.players).filter(
          (player) => player.health > 0,
        );
        Object.values(map.npcs).forEach((npc) => {
          if (tick % npcMoveTicks(npc) !== 0) return;
          updateNpcs(npc, map, livePlayers);
        });
      });
      break;
    }
    case ServerActionType.RegeneratePlayersHP:
      Object.values(getRuntimeState().maps).forEach((map) => {
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

function dispatchClientAction(action: ClientAction): void {
  if (action.type === 'keyboard') {
    handleKeyAction(action);
  } else if (action.type === 'item') {
    handleItemAction(action);
  } else if (action.type === 'chat') {
    handleChatAction(action);
  } else if (action.type === 'custom') {
    handleCustomAction(action);
  } else if (action.type === 'language') {
    // Through the queue like every other client message, so it lands between
    // ticks rather than under one: a command answering halfway through a frame
    // must not read one language for its first line and another for its next.
    const player = getPlayerByName(action.username);
    if (player) player.language = action.language;
  } else if (action.type === 'moveTo') {
    handleMoveTo(action);
  }
}

export function processActions() {
  let n = 0;
  while (actionQueue.size > 0) {
    const action = actionQueue.dequeue();

    if (action) {
      if (isClientAction(action)) {
        // Recorded before the handler, here where every client action passes,
        // so a recording holds the item use and chat line as well as the arrow
        // key, and an action that makes a handler throw is in the file too.
        recordAction(action);
        // Everything logged while this action is handled (a script that threw,
        // a warp with no map) names the action's player and tick. The id is a
        // counter, cheaper than a uuid and keyed to the tick like every other
        // line. `run` takes the action as an argument, so the hot path
        // allocates only the context object.
        reqCtx.run(
          { requestId: `${getTick()}.${n++}`, username: action.username },
          dispatchClientAction,
          action,
        );
      } else if (isServerAction(action)) {
        // No username to name: these are the tick's own work (npc update,
        // regen), not somebody's request.
        handleServerAction(action);
      }
    }
  }
}

/**
 * One queue per name for what a socket's arrival and departure do. Both
 * are async (a departure writes the character and frees the lease, an
 * arrival reads the document and takes it) and both concern one player. Out
 * of order, a reconnect could watch a late departure unregister it, or a
 * late arrival put back a character with no socket. In order, each sees the
 * world the one before it left.
 */
const lanes = new Map<string, Promise<void>>();

function inLane(username: string, work: () => Promise<void>): void {
  const next = (lanes.get(username) ?? Promise.resolve())
    .then(work)
    .catch((err: unknown) => {
      logger.error('[ws] session work failed', { username, err });
    })
    .finally(() => {
      if (lanes.get(username) === next) lanes.delete(username);
    });
  lanes.set(username, next);
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
    // Parsed rather than compared: the warp hand-off puts the trace it started
    // on the query string, because a browser cannot set a header on a
    // WebSocket. The path is still the only thing that decides the upgrade.
    const url = new URL(request.url ?? '', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // An upgrade has no response to write to; the session middleware only
    // reads the cookie off the request.
    sessionMiddleware(request as ExtendedRequest, {} as Response, () => {
      if ((request as ExtendedRequest).session.username) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          // The far end of a redirect continues the trace the other instance
          // opened, the one place two processes meet. An ordinary connection
          // carries none and gets no span.
          const handoff = parseTraceparent(
            url.searchParams.get('traceparent') ?? undefined,
          );
          if (handoff) {
            startSpan('warp.arrive', {
              parent: handoff,
              kind: 'server',
              attributes: {
                'player.name': (request as ExtendedRequest).session.username,
              },
            }).end();
          }
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
      // Whatever the socket it replaces was sent, this one has seen nothing:
      // the client starts its world over on a new socket, so the first frame
      // here has to carry everything in view rather than a delta against a
      // history that went down with the old one.
      resetPlayerNetState(username);
      // The socket edges are recorded too (recordSession): actions alone
      // cannot tell "stopped playing" from "kept walking".
      recordSession(username, 'join');

      // Held until the character is in the world. The first thing a client
      // says on open is its language, and read before there is a player to
      // set it on, every reply of the session would come back in English.
      ws.pause();
      inLane(username, async () => {
        try {
          const refused = await resumePlayer(username);
          if (refused && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'kick', message: refused }));
            ws.close();
          }
        } finally {
          // After a close too: a paused socket never reads the other end's
          // half of the closing handshake.
          ws.resume();
        }
      });

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

      // A socket that has already been replaced is not a departure. The
      // replacement above closes the old one, and that close lands a turn
      // later, with the new socket in the map: keyed by username alone, the
      // cleanup below would unregister the player who just reconnected and
      // drop the socket that took over. An entry that is gone rather than
      // different (kick, warp) is still this socket's own departure.
      const isCurrent = (): boolean => {
        const current = playersWsMap.get(username);
        return !current || current === ws;
      };

      ws.on('close', () => {
        if (!isCurrent()) return;
        recordSession(username, 'leave');
        if (!shuttingDown) inLane(username, () => disconnectPlayer(username));
        playersWsMap.delete(username);
        messageRate.delete(username);
      });

      ws.on('error', (err) => {
        logger.error('[ws] connection error', { username, err });
        if (!isCurrent()) return;
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
