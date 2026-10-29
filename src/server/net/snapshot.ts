import WebSocket from 'ws';
import {
  MapStateServer,
  PlayerServer,
  type DroppedItem,
} from '../../shared/types.js';
import {
  PROTOCOL_VERSION,
  type HealthChange,
} from '../../shared/wsProtocol.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getRuntimeState } from '../sim/world.js';
import { items } from '../services/content/itemService.js';
import {
  toPlayerPublic,
  toNpcPublic,
  toMapMeta,
  toMapChunk,
  toPlayerCold,
  toPlayerHot,
} from './serialization.js';
import {
  beginTick,
  currentTick,
  fragmentAt,
  fullBody,
  gapDelta,
  slotBornAt,
  slotOwnerId,
  slotCapacity,
  recordEntity,
  resyncBody,
} from './entityReplication.js';
import { queryEntitiesInRect } from '../sim/spatialManager.js';
import {
  type InterestState,
  chunkKey,
  createColdSnapshot,
  lastSentDroppedItems,
  lastSentPlayerCold,
  lastSentSelf,
  NO_HEALTH_CHANGES,
  pendingHealthChanges,
  playerChunkState,
  playerInterestSets,
  updateColdSnapshot,
} from './viewerState.js';
import { CHUNK_SIZE, TILE_SIZE } from '../../shared/constants.js';
import {
  type Viewport,
  calcViewport,
  mapTileWidth,
  mapTileHeight,
} from '../../shared/mapGeometry.js';
import { playersWsMap } from './connections.js';
import {
  nsCountBytes,
  nsCountChunk,
  nsCountDeferred,
  nsCountEntityLeave,
  nsCountWorldUpdate,
  nsCountPlayer,
  nsFlushTick,
} from './netStats.js';

// Handed out in creation order so viewers spread evenly over the cycle instead
// of all landing on the same tick, which would keep the peak this is meant to
// flatten and just make it happen half as often.
let nextPhase = 0;

const MAX_CHUNKS_PER_TICK = 8;

let lastCongestionLogMs = 0;

function sendMapMetaIfNeeded(
  player: PlayerServer,
  map: MapStateServer,
  mapRevision: number,
  ws: WebSocket,
) {
  const existing = playerChunkState.get(player.name);
  if (existing?.mapId === map.id && existing.revision === mapRevision) return;

  ws.send(
    JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'mapMeta',
      payload: toMapMeta(map),
    }),
  );
  playerChunkState.set(player.name, {
    mapId: map.id,
    revision: mapRevision,
    sent: new Set(),
  });
  // Changing map (or its revision) invalidates everything the client knows
  // about what is on screen, so the next update must resend entities in full.
  playerInterestSets.delete(player.name);
  lastSentDroppedItems.delete(player.name);
  lastSentSelf.delete(player.name);
}

function sendViewportChunks(
  player: PlayerServer,
  map: MapStateServer,
  ws: WebSocket,
  viewport: Viewport,
) {
  const state = playerChunkState.get(player.name);
  if (!state || state.mapId !== map.id) return;

  const vp = viewport;
  const chunkPx = CHUNK_SIZE * TILE_SIZE;
  const totalCols = Math.ceil(mapTileWidth(map.tiles) / CHUNK_SIZE);
  const totalRows = Math.ceil(mapTileHeight(map.tiles) / CHUNK_SIZE);

  const colFrom = Math.max(0, Math.floor(vp.left / chunkPx));
  const colTo = Math.min(totalCols - 1, Math.floor(vp.right / chunkPx));
  const rowFrom = Math.max(0, Math.floor(vp.top / chunkPx));
  const rowTo = Math.min(totalRows - 1, Math.floor(vp.bottom / chunkPx));

  let sent = 0;
  for (let cy = rowFrom; cy <= rowTo && sent < MAX_CHUNKS_PER_TICK; cy++) {
    for (let cx = colFrom; cx <= colTo && sent < MAX_CHUNKS_PER_TICK; cx++) {
      const key = chunkKey(cx, cy);
      if (state.sent.has(key)) continue;
      const chunkData = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'mapChunk',
        payload: toMapChunk(map, cx, cy),
      });
      ws.send(chunkData);
      nsCountChunk(chunkData.length);
      state.sent.add(key);
      sent++;
    }
  }
}

function sendPlayerStatsIfNeeded(player: PlayerServer, ws: WebSocket) {
  let snapshot = lastSentPlayerCold.get(player.name);
  if (!snapshot) {
    snapshot = createColdSnapshot();
    lastSentPlayerCold.set(player.name, snapshot);
  }
  // An empty snapshot always reports a change, so a viewer that just connected
  // (or was reset) receives its stats in full before any diffing starts.
  if (!updateColdSnapshot(player, snapshot)) return;

  try {
    ws.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'playerStats',
        payload: toPlayerCold(player),
      }),
    );
  } catch (err) {
    // The snapshot already advanced, so leaving it would mean never retrying:
    // the client would be stuck on whatever it last received. Drop it and let
    // the next tick rebuild in full.
    lastSentPlayerCold.delete(player.name);
    throw err;
  }
}

// Phase 1 of the tick: build every live entity's public state ONCE and cache
// its serialized fragments. Runs per map, not per viewer: an entity's public
// state is identical for everyone who can see it, so building it per viewer is
// the same work repeated.
function recordMapEntities(map: MapStateServer) {
  for (const player of Object.values(map.players)) {
    recordEntity(player.id, toPlayerPublic(player) as unknown as PublicRecord);
  }
  for (const npc of Object.values(map.npcs)) {
    if (npc.health > 0) {
      recordEntity(npc.id, toNpcPublic(npc) as unknown as PublicRecord);
    }
  }
}

type PublicRecord = Record<string, unknown>;

// Phase 2: assemble one viewer's message from the cached fragments. No object
// diffing here - only set membership and string concatenation.
function sendWorldUpdate(
  player: PlayerServer,
  map: MapStateServer,
  ws: WebSocket,
  viewport: Viewport,
  known: InterestState,
  mapHealthChanges: HealthChange[],
) {
  const nearby = queryEntitiesInRect(map.id, {
    x: viewport.left,
    y: viewport.top,
    width: viewport.right - viewport.left,
    height: viewport.bottom - viewport.top,
  });

  const tick = currentTick();
  const lastTick = known.lastTick;
  // Ticks this viewer has to be caught up on: 1 for one served every tick, more
  // when cadence or backpressure left it behind.
  const gap = tick - lastTick;
  const seen = known.seen;
  const knownIds: string[] = [];
  const knownSlots: number[] = [];
  const parts: string[] = [];
  let fullCount = 0;
  let partialCount = 0;

  for (const entity of nearby) {
    if (!entity.id) continue;

    if (entity.kind === 'player') {
      // The viewer's own state travels in `self`, not in `entities`.
      if (entity.id === player.id) continue;
      if (!map.players[entity.id]) continue;
    } else if (entity.kind === 'npc') {
      const npc = map.npcs[entity.id];
      if (!npc || npc.health <= 0) continue;
    } else {
      continue;
    }

    // Anything phase 1 did not record has neither a slot nor a body to send.
    const fragment = fragmentAt(entity.id);
    if (!fragment) continue;
    const slot = fragment.slot;

    // Knowledge is read before membership is written. A slot that changed
    // hands since this viewer was last served is not knowledge of its new
    // holder, which needs full state. A fresh viewer has `lastTick` -1, which
    // zero-filled `seen` (written only with ticks from 1) never holds.
    const viewerKnows = seen[slot] === lastTick && fragment.born <= lastTick;
    seen[slot] = tick;
    knownIds.push(entity.id);
    knownSlots.push(slot);

    // Nothing has happened to it since this viewer was last served, whether
    // that was last tick or ten ticks ago: it is already showing the truth.
    if (viewerKnows && fragment.changedAt <= lastTick) continue;

    // A viewer that never saw this entity gets the full state and inserts it.
    // One that knows it gets the changes over its gap, or the resync body when
    // the gap outruns the history, which is merged and so spells out the
    // fields that went away.
    let body: string | undefined;
    let isDelta = false;
    if (viewerKnows) {
      const merged = gapDelta(fragment, gap);
      body = merged ?? resyncBody(fragment);
      isDelta = merged !== null;
    } else {
      body = fullBody(fragment);
    }

    if (body === undefined) continue;
    parts.push(`${fragment.quotedId}:${body}`);
    if (isDelta) partialCount++;
    else fullCount++;
  }

  const leaving: string[] = [];
  for (let i = 0; i < known.knownIds.length; i++) {
    const id = known.knownIds[i]!;
    const slot = known.knownSlots[i]!;
    // `slotOwnerId` is what makes recycling safe here: if the slot has been
    // taken over (or freed) since, the sighting recorded in `seen` is not
    // about `id`, and `id` is gone as far as this viewer is concerned.
    // An id that took its slot after the viewer was last served came back
    // while it was not looking. It was sent whole above, and leaving it too
    // makes the client drop the old copy instead of merging into it.
    if (
      slotOwnerId(slot) !== id ||
      seen[slot] !== tick ||
      slotBornAt(slot)! > lastTick
    )
      leaving.push(id);
  }

  known.knownIds = knownIds;
  known.knownSlots = knownSlots;
  known.lastTick = tick;

  const visibleDrops = map.droppedItems
    .filter((item: DroppedItem) => withinViewport(item.position, viewport))
    .map(({ itemId, position, sprite, quantity }) => ({
      itemId,
      position,
      sprite,
      quantity,
      name: items.get(itemId)?.name,
    }));
  const dropsJson = JSON.stringify(visibleDrops);
  const dropsChanged = lastSentDroppedItems.get(player.name) !== dropsJson;

  // The viewer is excluded from `entities` (its state travels in `self`), so
  // `self` must be part of the send condition: a player alone on a map would
  // otherwise never receive its own authoritative position and client-side
  // prediction would never be reconciled.
  const selfJson = JSON.stringify(toPlayerHot(player));
  const selfChanged = lastSentSelf.get(player.name) !== selfJson;

  const healthChanges = mapHealthChanges.filter((c) =>
    withinViewport(c, viewport),
  );

  if (
    parts.length === 0 &&
    leaving.length === 0 &&
    !dropsChanged &&
    !selfChanged &&
    healthChanges.length === 0
  ) {
    return;
  }

  const drops = dropsChanged ? `,"droppedItems":${dropsJson}` : '';
  const hits =
    healthChanges.length > 0
      ? `,"healthChanges":${JSON.stringify(healthChanges)}`
      : '';
  const data =
    `{"v":${PROTOCOL_VERSION},"type":"worldUpdate","payload":{` +
    `"entities":{${parts.join(',')}},` +
    `"leave":${JSON.stringify(leaving)},` +
    `"self":${selfJson}${drops}${hits}}}`;

  ws.send(data);
  lastSentDroppedItems.set(player.name, dropsJson);
  lastSentSelf.set(player.name, selfJson);

  nsCountBytes(data.length);
  nsCountWorldUpdate(data.length, fullCount, partialCount);
  if (leaving.length > 0) nsCountEntityLeave(leaving.length, 0);
}

/**
 * This viewer's interest state, grown to cover every slot in existence. A
 * fresh array is zero-filled and `lastTick` starts below zero, so no slot
 * reads as "seen last tick" and a new viewer is not sent deltas for
 * entities it never saw.
 */
function interestStateFor(name: string): InterestState {
  const capacity = slotCapacity();
  const existing = playerInterestSets.get(name);

  if (existing) {
    if (existing.seen.length < capacity) {
      const grown = new Int32Array(
        Math.max(capacity, existing.seen.length * 2),
      );
      grown.set(existing.seen);
      existing.seen = grown;
    }
    return existing;
  }

  const fresh: InterestState = {
    seen: new Int32Array(Math.max(capacity, 64)),
    knownIds: [],
    knownSlots: [],
    lastTick: -1,
    phase: nextPhase++ % Math.max(1, config.net.viewerCadenceTicks),
  };
  playerInterestSets.set(name, fresh);
  return fresh;
}

/**
 * Whether this viewer gets a world update on this tick. One never served is
 * always due, or a client that just connected could stare at an empty map
 * for a cycle; otherwise it is the plain cycle, and what a skipped viewer
 * misses is handled where the fragment is chosen.
 */
function viewerDue(known: InterestState, tick: number): boolean {
  const cadence = config.net.viewerCadenceTicks;
  if (cadence <= 1 || known.lastTick < 0) return true;
  return (tick + known.phase) % cadence === 0;
}

function withinViewport(pos: { x: number; y: number }, vp: Viewport): boolean {
  return (
    pos.x >= vp.left &&
    pos.x <= vp.right &&
    pos.y >= vp.top &&
    pos.y <= vp.bottom
  );
}

export function broadcastGameState() {
  const gameState = getRuntimeState();
  const marginPx = config.net.aoiMarginTiles * TILE_SIZE;

  // Fragments are per-tick; clear them before any map is serialized.
  beginTick();

  for (const map of Object.values(gameState.maps)) {
    const mapRevision = map.tilesRevision ?? 0;
    const viewers = Object.values(map.players);

    // A map nobody stands on is not serialized at all: there is no one to send
    // its entities to and no one holding them. Whoever arrives starts from an
    // empty interest state and is sent every entity whole; a viewer coming back
    // with an older one spans ticks the history never recorded, which
    // `gapDelta` answers with null, and so gets the resync body. Its entities
    // keep their last baseline and diff against it once the map has a player.
    if (viewers.length === 0) continue;

    recordMapEntities(map);

    for (const player of viewers) {
      const ws = playersWsMap.get(player.name);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;

      // Backpressure: a slow client's send buffer would grow unbounded if we
      // kept queueing per-tick snapshots. Skip this tick for it; the next
      // snapshot diffs against the last state we actually sent, so it resyncs
      // once the buffer drains.
      if (ws.bufferedAmount > config.ws.maxBufferedBytes) {
        const now = Date.now();
        if (now - lastCongestionLogMs > 5000) {
          logger.warn('[net] skipping snapshot for congested client', {
            player: player.name,
            bufferedAmount: ws.bufferedAmount,
          });
          lastCongestionLogMs = now;
        }
        continue;
      }

      try {
        nsCountPlayer();
        sendMapMetaIfNeeded(player, map, mapRevision, ws);
        const viewport = calcViewport(
          player.position.x,
          player.position.y,
          map.tiles,
          marginPx,
          map.orientation,
        );
        sendViewportChunks(player, map, ws, viewport);
        sendPlayerStatsIfNeeded(player, ws);

        // Read after the calls above, because a map change drops this viewer's
        // interest state and the fresh one has to be the one that decides.
        const known = interestStateFor(player.name);
        if (!viewerDue(known, currentTick())) {
          nsCountDeferred();
          continue;
        }
        sendWorldUpdate(
          player,
          map,
          ws,
          viewport,
          known,
          pendingHealthChanges.get(map.id) ?? NO_HEALTH_CHANGES,
        );
      } catch (error) {
        logger.error('Error broadcasting to player', {
          player: player.name,
          err: error,
        });
      }
    }
  }
  pendingHealthChanges.clear();
  nsFlushTick();
}

export { broadcastGameState as broadcast };
