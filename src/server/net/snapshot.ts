import WebSocket from 'ws';
import * as jsondiffpatch from 'jsondiffpatch';
import {
  ChatMessagePayload,
  MapStateServer,
  PlayerServer,
} from '../../shared/types.js';
import type {
  FullGameStatePayload,
  GameStateDeltaPayload,
} from '../../shared/wsProtocol.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getMap } from '../gameData.js';
import { getGameState } from '../services/gameService.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { toMapDynamicClient, toMapMeta, toMapChunk } from './serialization.js';
import {
  getPlayerByName,
  playerColdSignature,
  toPlayerCold,
  toPlayerHot,
} from '../services/playerService.js';
import { CHUNK_SIZE, TILE_SIZE } from '../../shared/constants.js';
import {
  calcViewport,
  mapTileWidth,
  mapTileHeight,
} from '../../shared/mapGeometry.js';
import { playersWsMap } from './connections.js';
import {
  nsCountBytes,
  nsCountChunk,
  nsCountDelta,
  nsCountEntityLeave,
  nsCountFullState,
  nsCountPlayer,
  nsFlushTick,
} from './netStats.js';

const diffPatcher = jsondiffpatch.create({
  objectHash: (obj: any, index?: number): string | undefined => {
    return obj.id || obj.name || `$$index:${index}`;
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
});

export const lastSentStates = new Map<string, FullGameStatePayload>();
const lastSentPlayerColdSig = new Map<string, string>();

interface ChunkState {
  mapId: string;
  revision: number;
  sent: Set<string>;
}
const playerChunkState = new Map<string, ChunkState>();

interface InterestSets {
  players: Set<string>;
  npcs: Set<string>;
}
const playerInterestSets = new Map<string, InterestSets>();

const MAX_CHUNKS_PER_TICK = 8;

export function resetPlayerNetState(name: string) {
  lastSentStates.delete(name);
  lastSentPlayerColdSig.delete(name);
  playerChunkState.delete(name);
  playerInterestSets.delete(name);
}

function sendMapMetaIfNeeded(
  player: PlayerServer,
  map: MapStateServer,
  mapRevision: number,
  ws: WebSocket,
) {
  const existing = playerChunkState.get(player.name);
  if (existing?.mapId === map.id && existing.revision === mapRevision) return;

  ws.send(JSON.stringify({ type: 'mapMeta', payload: toMapMeta(map) }));
  playerChunkState.set(player.name, {
    mapId: map.id,
    revision: mapRevision,
    sent: new Set(),
  });
  lastSentStates.delete(player.name);
  playerInterestSets.delete(player.name);
}

function sendViewportChunks(
  player: PlayerServer,
  map: MapStateServer,
  ws: WebSocket,
  marginPx: number,
) {
  const state = playerChunkState.get(player.name);
  if (!state || state.mapId !== map.id) return;

  const vp = calcViewport(
    player.position.x,
    player.position.y,
    map.tiles,
    marginPx,
  );
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
      const key = `${cx}:${cy}`;
      if (state.sent.has(key)) continue;
      const chunkData = JSON.stringify({
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
  const signature = playerColdSignature(player);
  if (lastSentPlayerColdSig.get(player.name) === signature) return;

  ws.send(
    JSON.stringify({ type: 'playerStats', payload: toPlayerCold(player) }),
  );
  lastSentPlayerColdSig.set(player.name, signature);
}

function sendDynamicSnapshot(
  player: PlayerServer,
  map: MapStateServer,
  ws: WebSocket,
  marginPx: number,
) {
  const viewport = calcViewport(
    player.position.x,
    player.position.y,
    map.tiles,
    marginPx,
  );
  const dynClient = toMapDynamicClient(map, player, viewport);

  // Detect entities leaving the viewport and send explicit tombstones.
  // This avoids jsondiffpatch generating costly delete deltas (which include
  // the full previous entity state in the wire format).
  const currentPlayerIds = new Set(Object.keys(dynClient.players));
  const currentNpcIds = new Set(Object.keys(dynClient.npcs));
  const prevSets = playerInterestSets.get(player.name);

  if (prevSets) {
    const leavingPlayers: string[] = [];
    const leavingNpcs: string[] = [];
    for (const id of prevSets.players) {
      if (!currentPlayerIds.has(id)) leavingPlayers.push(id);
    }
    for (const id of prevSets.npcs) {
      if (!currentNpcIds.has(id)) leavingNpcs.push(id);
    }
    if (leavingPlayers.length > 0 || leavingNpcs.length > 0) {
      const leaveData = JSON.stringify({
        type: 'entityLeave',
        payload: { players: leavingPlayers, npcs: leavingNpcs },
      });
      ws.send(leaveData);
      nsCountEntityLeave(
        leavingPlayers.length + leavingNpcs.length,
        leaveData.length,
      );
      // Prune lastSentState so jsondiffpatch never sees these as deleted keys.
      const lastState = lastSentStates.get(player.name);
      if (lastState) {
        for (const id of leavingPlayers) delete lastState.map.players[id];
        for (const id of leavingNpcs) delete lastState.map.npcs[id];
      }
    }
  }

  playerInterestSets.set(player.name, {
    players: currentPlayerIds,
    npcs: currentNpcIds,
  });

  const currentState: FullGameStatePayload = structuredClone({
    map: dynClient,
    player: toPlayerHot(player),
  });

  const lastState = lastSentStates.get(player.name);
  let message: {
    type: string;
    payload: FullGameStatePayload | GameStateDeltaPayload;
  } | null = null;

  if (!lastState) {
    message = { type: 'fullGameState', payload: currentState };
  } else {
    const delta = diffPatcher.diff(lastState, currentState);
    if (delta) {
      message = { type: 'gameStateDelta', payload: delta };
    }
  }

  if (message) {
    const data = JSON.stringify(message);
    ws.send(data);
    nsCountBytes(data.length);
    if (message.type === 'fullGameState') nsCountFullState(data.length);
    else nsCountDelta(data.length);
    lastSentStates.set(player.name, currentState);
  }
}

export function broadcastGameState() {
  const gameState = getGameState();
  const marginPx = config.net.aoiMarginTiles * TILE_SIZE;

  for (const map of Object.values(gameState.maps)) {
    const mapRevision = map.tilesRevision ?? 0;

    for (const player of Object.values(map.players)) {
      const ws = playersWsMap.get(player.name);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;

      try {
        nsCountPlayer();
        sendMapMetaIfNeeded(player, map, mapRevision, ws);
        sendViewportChunks(player, map, ws, marginPx);
        sendPlayerStatsIfNeeded(player, ws);
        sendDynamicSnapshot(player, map, ws, marginPx);
      } catch (error) {
        logger.error('Error broadcasting to player', {
          player: player.name,
          err: error,
        });
      }
    }
  }
  nsFlushTick();
}

export function broadcastChat(message: ChatMessagePayload) {
  const data = JSON.stringify(message);

  playersWsMap.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

export function broadcastMapChat(
  senderUsername: string,
  message: ChatMessagePayload,
) {
  const player = getPlayerByName(senderUsername);
  const map = getMap(player?.mapId);

  Object.values(map?.players ?? {}).forEach((p) => {
    const ws = playersWsMap.get(p.name);
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

export function flushGameEvents() {
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
      case 'chatPlayer': {
        const ws = playersWsMap.get(event.username);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(event.payload));
        }
        break;
      }
      case 'customPlayer': {
        const ws = playersWsMap.get(event.username);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'custom',
              channel: event.channel,
              payload: event.payload,
            }),
          );
        }
        break;
      }
      case 'customMap':
        sendCustomToMap(event.mapId, event.channel, event.payload);
        break;
      case 'customAll':
        broadcastCustom(event.channel, event.payload);
        break;
    }
  }
}

function broadcastCustom(channel: string, payload: unknown) {
  const data = JSON.stringify({ type: 'custom', channel, payload });
  playersWsMap.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function sendCustomToMap(mapId: string, channel: string, payload: unknown) {
  const map = getMap(mapId);
  if (!map) return;
  const data = JSON.stringify({ type: 'custom', channel, payload });
  Object.values(map.players).forEach((player) => {
    const ws = playersWsMap.get(player.name);
    if (ws?.readyState === WebSocket.OPEN) ws.send(data);
  });
}

export { broadcastGameState as broadcast };
