import type { MapStateClient, Position } from '../../../../shared/types';
import type {
  WsServerFullGameStateMessage,
  WsServerGameStateDeltaMessage,
  WsServerMapStaticMessage,
  WsServerPlayerStatsMessage,
} from '../../../../shared/wsProtocol';
import {
  getPlayer,
  getGameState,
  patchGameState,
  setFullGameState,
  setPlayerStats,
  setStaticMap,
} from '../../../core/gameState';
import { onServerPositionUpdate } from '../../../graphics/movementAnimation';
import { useUIStore } from '../../../stores/uiStore';

type GameStateMessage =
  | WsServerMapStaticMessage
  | WsServerPlayerStatsMessage
  | WsServerFullGameStateMessage
  | WsServerGameStateDeltaMessage;

const gameStateQueue: Array<GameStateMessage> = [];

export function enqueueGameStateMessage(message: GameStateMessage) {
  gameStateQueue.push(message);
}

const lastPlayerPositions = new Map<string, Position>();
const lastNpcPositions = new Map<string, Position>();
let lastLocalPosition: Position | null = null;

export function resetInterpolation() {
  lastPlayerPositions.clear();
  lastNpcPositions.clear();
  lastLocalPosition = null;
}

function trackInterpolation(
  entities: Record<string, { position: Position }>,
  store: Map<string, Position>,
): void {
  for (const [id, entity] of Object.entries(entities)) {
    const prev = store.get(id);
    if (prev && (prev.x !== entity.position.x || prev.y !== entity.position.y)) {
      onServerPositionUpdate(id, prev, entity.position);
    }
    store.set(id, { ...entity.position });
  }

  for (const id of store.keys()) {
    if (!entities[id]) store.delete(id);
  }
}

function interpolateEntities(map: MapStateClient): void {
  trackInterpolation(map.players, lastPlayerPositions);
  trackInterpolation(map.npcs, lastNpcPositions);
}

// The local player is not in map.players, so interpolate it from the server
// position changes the same way (smooth slide to the authoritative position).
function interpolateLocalPlayer(player: { id: string; position: Position }) {
  const prev = lastLocalPosition;
  if (prev && (prev.x !== player.position.x || prev.y !== player.position.y)) {
    onServerPositionUpdate(player.id, prev, player.position);
  }
  lastLocalPosition = { ...player.position };
}

export function updateWebSocket(): void {
  while (gameStateQueue.length > 0) {
    const message = gameStateQueue.shift();

    if (!message?.payload) continue;

    if (message.type === 'mapStatic') {
      setStaticMap(message.payload);
      // entering a new map: drop stale positions so we don't slide across it
      resetInterpolation();
    } else if (message.type === 'playerStats') {
      setPlayerStats(message.payload);
    } else if (message.type === 'fullGameState') {
      setFullGameState(message.payload);
    } else if (message.type === 'gameStateDelta') {
      patchGameState(message.payload);
    }

    const currentPlayer = getPlayer();
    const currentMap = getGameState();

    if (currentMap) {
      useUIStore.getState().setCurrentMap(currentMap);
      interpolateEntities(currentMap);
    }

    if (currentPlayer) {
      interpolateLocalPlayer(currentPlayer);
    }
  }
}
