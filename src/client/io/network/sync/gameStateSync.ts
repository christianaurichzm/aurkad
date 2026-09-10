import type { MapStateClient, Position } from '../../../../shared/types';
import type {
  WsServerMapChunkMessage,
  WsServerMapMetaMessage,
  WsServerPlayerStatsMessage,
  WsServerWorldUpdateMessage,
} from '../../../../shared/wsProtocol';
import {
  applyMapChunk,
  applyWorldUpdate,
  expectWholeWorld,
  getPlayer,
  getGameState,
  setMapMeta,
  setPlayerStats,
} from '../../../core/gameState';
import { onServerPositionUpdate } from '../../../graphics/movementAnimation';
import { useUIStore } from '../../../stores/uiStore';
import {
  playMusic,
  stopMusic,
  playSound,
  setAudioListener,
} from '../../../audio';
import { onServerEvent } from '../customEvents';
import { spawnAttackEffect } from '../../../graphics/attackEffect';
import { spawnSpellEffect } from '../../../graphics/spellEffect';
import { CharacterAction, Direction } from '../../../../shared/types';

type GameStateMessage =
  | WsServerMapMetaMessage
  | WsServerMapChunkMessage
  | WsServerPlayerStatsMessage
  | WsServerWorldUpdateMessage;

const gameStateQueue: Array<GameStateMessage> = [];

// `x`/`y` are optional and place the sound: a tile trigger fires under the
// player and sends none, while a script placing a sound on an npc, a door or
// a chest sends its position.
onServerEvent('sound:play', (payload) => {
  const p = payload as { file?: string; x?: number; y?: number };
  if (!p.file) return;
  playSound(
    p.file,
    typeof p.x === 'number' && typeof p.y === 'number'
      ? { x: p.x, y: p.y }
      : undefined,
  );
});

onServerEvent('attack:hit', (payload) => {
  const p = payload as { x: number; y: number; dir: Direction };
  spawnAttackEffect(p.x, p.y, p.dir);
  playSound('attack.mp3');
});

onServerEvent('projectile:fire', (payload) => {
  const p = payload as { fromX?: number; fromY?: number };
  playSound(
    'arrow.mp3',
    typeof p?.fromX === 'number' && typeof p.fromY === 'number'
      ? { x: p.fromX, y: p.fromY }
      : undefined,
  );
});

onServerEvent('spell:visual', (payload) => {
  const p = payload as { x: number; y: number; sprite: number };
  spawnSpellEffect(p.x, p.y, p.sprite ?? 0);
  playSound('magiceffect.mp3', { x: p.x, y: p.y });
});

export function enqueueGameStateMessage(message: GameStateMessage) {
  gameStateQueue.push(message);
}

/**
 * A new socket is open. Updates still queued from the old one were meant for
 * a viewer the server has forgotten, and the next world update holds
 * everything in view.
 */
export function startOverOnNewSocket(): void {
  gameStateQueue.length = 0;
  expectWholeWorld();
}

/** What an entity looked like on the last update this client applied. */
type LastSeen = { position: Position; action?: CharacterAction };

const lastPlayerState = new Map<string, LastSeen>();
const lastNpcState = new Map<string, LastSeen>();
let lastLocalPosition: Position | null = null;

export function resetInterpolation() {
  lastPlayerState.clear();
  lastNpcState.clear();
  lastLocalPosition = null;
}

function trackEntities(
  entities: Record<string, LastSeen>,
  store: Map<string, LastSeen>,
): void {
  for (const [id, entity] of Object.entries(entities)) {
    const prev = store.get(id);
    if (
      prev &&
      (prev.position.x !== entity.position.x ||
        prev.position.y !== entity.position.y)
    ) {
      onServerPositionUpdate(id, prev.position, entity.position);
    }
    // The swing you hear from someone else. `action` is already in the
    // per-tick snapshot, so the edge into Attack costs no event, while
    // `attack:hit` goes to the attacker alone. An entity seen for the first
    // time has no previous state and stays silent.
    if (
      prev &&
      prev.action !== entity.action &&
      entity.action === CharacterAction.Attack
    ) {
      playSound('attack.mp3', entity.position);
    }
    store.set(id, {
      position: { ...entity.position },
      action: entity.action,
    });
  }

  for (const id of store.keys()) {
    if (!entities[id]) store.delete(id);
  }
}

function interpolateEntities(map: MapStateClient): void {
  trackEntities(map.players, lastPlayerState);
  trackEntities(map.npcs, lastNpcState);
}

// The local player is not in map.players, so interpolate it from the server
// position changes the same way (smooth slide to the authoritative position).
function interpolateLocalPlayer(player: { id: string; position: Position }) {
  // The ears go where the local player is: every placed sound is measured from
  // here, and this is the one place that already knows it every update.
  setAudioListener(player.position);
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
    } else if (message.type === 'playerStats') {
      setPlayerStats(message.payload);
    } else if (message.type === 'worldUpdate') {
      applyWorldUpdate(message.payload);
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
