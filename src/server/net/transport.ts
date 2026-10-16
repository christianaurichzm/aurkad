import { RequestHandler, Response } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { logger } from '../logger.js';
import {
  ActionQueueItem,
  ClientAction,
  ServerAction,
  ServerActionType,
} from '../engine/actions.js';
import { ClientMessageSchema } from './clientMessage.js';
import type { z } from 'zod';
import type { Key } from '../../shared/types.js';
import { config } from '../config.js';
import type { ExtendedRequest } from '../http/session.js';
import { handleChatAction } from '../services/comms/chatService.js';
import {
  disconnectPlayer,
  authEpochOf,
  getPlayerByName,
  resumePlayer,
} from '../services/player/playerService.js';
import {
  handleKeyAction,
  handleMoveTo,
  clearPressedKeys,
  warpToMap,
} from '../services/world/movementService.js';
import { getMap, getRuntimeState } from '../sim/world.js';
import { isInstanceTemplate } from '../services/world/instanceService.js';
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
  /** Keys whose release this window was let past the limit. */
  released: Set<Key>;
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

const actionQueue = new FastQueue<{
  action: ActionQueueItem;
  socket?: WebSocket;
}>();
const socketEpochs = new WeakMap<WebSocket, number>();

export function revokePlayerSessions(username: string, epoch: number): void {
  const ws = playersWsMap.get(username);
  if (ws && (socketEpochs.get(ws) ?? 0) < epoch) {
    clearPressedKeys(username);
    ws.close(1008, 'Session revoked');
  }
}
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
    messageRate.set(username, {
      windowStartMs: now,
      count: 1,
      dropped: 0,
      released: new Set(),
    });
    return false;
  }

  state.count++;
  if (state.count > limit) {
    state.dropped++;
    return true;
  }

  return false;
}

/**
 * Whether a message past the limit is a key release to keep anyway.
 *
 * Dropped, a release leaves the key held here and the character walking with
 * nobody pressing anything. Once per key per window is every release an honest
 * client can owe, and keeps a flood of them bounded.
 */
function releasePastLimit(
  username: string,
  message: z.infer<typeof ClientMessageSchema>,
): boolean {
  if (message.type !== 'keyboard' || message.keyboardAction.type !== 'release')
    return false;
  const released = messageRate.get(username)?.released;
  const key = message.keyboardAction.key;
  if (!released || released.has(key)) return false;
  released.add(key);
  return true;
}

/** Longer than any release, which is the only thing parsed past the limit. */
const RELEASE_MAX_BYTES = 256;

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

function enqueueAction(action: ActionQueueItem, socket?: WebSocket) {
  const maxSize = config.limits.actionQueueMaxSize;
  if (maxSize > 0 && actionQueue.size >= maxSize) {
    const dropped = actionQueue.dequeue();
    if (
      dropped &&
      (!dropped.socket || dropped.socket.readyState === WebSocket.OPEN)
    )
      applyDroppedRelease(dropped.action);
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

  actionQueue.enqueue({ action, socket });
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
        if (isInstanceTemplate(map)) return;
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
    const queued = actionQueue.dequeue();
    if (!queued) continue;
    const { action, socket } = queued;
    if (
      socket &&
      (socket.readyState !== WebSocket.OPEN ||
        (isClientAction(action) &&
          playersWsMap.get(action.username) !== socket))
    )
      continue;

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

/**
 * A browser sends the page's origin on every WebSocket handshake, and the
 * session cookie with it, so without this any page on a sibling subdomain
 * (SameSite lets those through) could open a socket as the player. The game's
 * own page passes as same-host whether or not CORS_ALLOWED_ORIGINS names it.
 * No Origin means no browser, and no cookie it did not mean to send.
 */
function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const allowed = config.cors.allowedOrigins;
  if (allowed.includes('*') || allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
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
    let checkFailed = false;
    for (const [username, ws] of playersWsMap) {
      // The bus accelerates revocation; this check also covers a lost event.
      // A database that cannot answer has revoked nothing: closing here would
      // drop every player on a replica set election, which the write-behind
      // loop exists to ride out. The next beat checks again.
      void authEpochOf(username)
        .then((epoch) => {
          if (playersWsMap.get(username) !== ws) return;
          if (epoch !== (socketEpochs.get(ws) ?? 0)) {
            clearPressedKeys(username);
            ws.close(1008, 'Session revoked');
          }
        })
        .catch((err) => {
          if (checkFailed) return;
          checkFailed = true;
          logger.warn('[ws] session check unavailable; sockets kept', { err });
        });
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
    if (!originAllowed(request)) {
      // Said out loud: a CORS_ALLOWED_ORIGINS that leaves out where the game is
      // served from looks, from the browser, like a server that is down.
      logger.warn('[ws] handshake from an origin not allowed', {
        origin: request.headers.origin,
      });
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }

    // An upgrade has no response to write to; the session middleware only
    // reads the cookie off the request. A session store that failed leaves no
    // session at all, which is refused like one naming nobody.
    sessionMiddleware(request as ExtendedRequest, {} as Response, () => {
      if ((request as Partial<ExtendedRequest>).session?.username) {
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
      const authEpoch = request.session.authEpoch ?? 0;
      socketEpochs.set(ws, authEpoch);
      // Whatever the socket it replaces was sent, this one has seen nothing:
      // the client starts its world over on a new socket, so the first frame
      // here has to carry everything in view rather than a delta against a
      // history that went down with the old one.
      resetPlayerNetState(username);
      // Same for input: the keys held are the old client's, and its releases
      // will never arrive. This one sends its own once it is up.
      clearPressedKeys(username);
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
          if ((await authEpochOf(username)) !== authEpoch) {
            ws.close(1008, 'Session revoked');
            return;
          }
          if (refused && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'kick', message: refused }));
            ws.close();
          } else if (!refused) {
            // Saved on a map another instance runs (a logout there, a login
            // here), the character is in no map until that instance has
            // them, and the warp's redirect is the way there.
            const player = getPlayerByName(username);
            if (player && !getMap(player.mapId))
              warpToMap(player, player.mapId, player.position);
          }
        } catch (err) {
          ws.close(1011, 'Session validation unavailable');
          throw err;
        } finally {
          // After a close too: a paused socket never reads the other end's
          // half of the closing handshake.
          ws.resume();
        }
      });

      ws.on('message', (message, isBinary) => {
        if (isBinary) return;
        const limited = isRateLimited(username);

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
          if (limited && bytes.length > RELEASE_MAX_BYTES) return;
          raw = JSON.parse(bytes.toString('utf8'));
        } catch {
          return;
        }

        const result = ClientMessageSchema.safeParse(raw);
        if (!result.success) return;
        if (limited && !releasePastLimit(username, result.data)) return;

        enqueueAction({ username, ...result.data }, ws);
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

/**
 * A client action with no socket behind it, for the sim fixture: the same
 * queue a socket's message lands in, minus the connection checks that only a
 * socket can fail.
 */
export function enqueueClientAction(action: ClientAction) {
  enqueueAction(action);
}

export function clearActionQueue() {
  actionQueue.clear();
}
