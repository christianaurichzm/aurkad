import type { MapStateClient, Position } from '../../../../shared/types';
import type {
  WsServerEntityLeaveMessage,
  WsServerFullGameStateMessage,
  WsServerGameStateDeltaMessage,
  WsServerMapChunkMessage,
  WsServerMapMetaMessage,
  WsServerPlayerStatsMessage,
} from '../../../../shared/wsProtocol';
import {
  applyMapChunk,
  getPlayer,
  getGameState,
  patchGameState,
  removeEntities,
  setFullGameState,
  setMapMeta,
  setPlayerStats,
} from '../../../core/gameState';
import { onServerPositionUpdate } from '../../../graphics/movementAnimation';
import { useUIStore } from '../../../stores/uiStore';
import { playMusic, stopMusic, playSound } from '../../../audio';
import { onServerEvent } from '../customEvents';
import { spawnAttackEffect } from '../../../graphics/attackEffect';
import { spawnSpellEffect } from '../../../graphics/spellEffect';
import { Direction } from '../../../../shared/types';

type GameStateMessage =
  | WsServerMapMetaMessage
  | WsServerMapChunkMessage
  | WsServerEntityLeaveMessage
  | WsServerPlayerStatsMessage
  | WsServerFullGameStateMessage
  | WsServerGameStateDeltaMessage;

const gameStateQueue: Array<GameStateMessage> = [];

onServerEvent('sound:play', (payload) => {
  const p = payload as { file?: string };
  if (p.file) playSound(p.file);
});

onServerEvent('attack:hit', (payload) => {
  const p = payload as { x: number; y: number; dir: Direction };
  spawnAttackEffect(p.x, p.y, p.dir);
  playSound('attack.mp3');
});

onServerEvent('projectile:fire', () => {
  playSound('arrow.mp3');
});

onServerEvent('spell:visual', (payload) => {
  const p = payload as { x: number; y: number; sprite: number };
  spawnSpellEffect(p.x, p.y, p.sprite ?? 0);
  playSound('magiceffect.mp3');
});

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
    if (
      prev &&
      (prev.x !== entity.position.x || prev.y !== entity.position.y)
    ) {
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

    if (message.type === 'mapMeta') {
      const newMusic = message.payload.music;
      if (newMusic) {
        playMusic(newMusic);
      } else {
        stopMusic();
      }
      setMapMeta(message.payload);
      resetInterpolation();
    } else if (message.type === 'mapChunk') {
      applyMapChunk(message.payload);
    } else if (message.type === 'entityLeave') {
      removeEntities(message.payload.players, message.payload.npcs);
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
