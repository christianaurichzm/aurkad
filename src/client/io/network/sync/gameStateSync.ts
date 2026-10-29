import type { MapStateClient, Position } from '../../../../shared/types';
import type {
  HealthChange,
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
import {
  clearMovementQueues,
  forgetMovement,
  onServerPositionUpdate,
} from '../../../graphics/movementAnimation';
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
import { spawnFloatingText, themeToken } from '../../../graphics/floatingText';
import { getAnimatedPos } from '../../../graphics/entityRendering';
import { spritePosition } from '../../../graphics/camera';
import { TILE_SIZE } from '../../../../shared/constants';
import { CharacterAction, Direction } from '../../../../shared/types';

type GameStateMessage =
  | WsServerMapMetaMessage
  | WsServerMapChunkMessage
  | WsServerPlayerStatsMessage
  | WsServerWorldUpdateMessage;

const gameStateQueue: Array<GameStateMessage> = [];

// A number per hit or heal, rising over the entity and following it if it
// walks on. Hits taken are in the danger colour so they read apart from hits
// dealt; several on one entity in the same update stack instead of overlapping.
function showHealthChanges(changes: HealthChange[] | undefined): void {
  if (!changes) return;
  const selfId = getPlayer()?.id;
  const npcs = getGameState()?.npcs;
  const stacked = new Map<string, number>();
  for (const change of changes) {
    const n = stacked.get(change.id) ?? 0;
    stacked.set(change.id, n + 1);
    const lift = 4 + n * 18;
    const color =
      change.delta > 0
        ? themeToken('--color-success', '#5fbf6a')
        : change.id === selfId
          ? themeToken('--color-danger-text', '#ff8b86')
          : '#ffffff';
    // Over the middle of a big npc, not the corner its position names.
    const half = (npcs?.[change.id]?.width ?? TILE_SIZE) / 2;
    const at = spritePosition(change.x, change.y);
    spawnFloatingText(
      at.x + half,
      at.y - lift,
      change.delta > 0 ? `+${change.delta}` : String(-change.delta),
      color,
      1000,
      20,
      () => {
        const pos = getAnimatedPos(change.id);
        if (!pos) return null;
        const to = spritePosition(pos.x, pos.y);
        return { x: to.x + half, y: to.y - lift };
      },
    );
  }
}

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
  const p = payload as {
    x: number;
    y: number;
    sprite: number;
    frames?: number;
  };
  spawnSpellEffect(p.x, p.y, p.sprite ?? 0, p.frames ?? 1);
  playSound('magiceffect.mp3', { x: p.x, y: p.y });
});

export function enqueueGameStateMessage(message: GameStateMessage) {
  gameStateQueue.push(message);
  // A hidden tab draws no frames, and frames drain this queue: without this a
  // background tab holds every update and applies them all when it comes back.
  if (document.hidden) updateWebSocket();
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
  // Queued slides outlive the entity. An npc with a step left from the last
  // visit to this map would snap back to that old position when drawn, and its
  // next move would start from there instead of where the server has it.
  clearMovementQueues();
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

  // A slide left from before it went would otherwise draw an entity that
  // comes back under its id (an npc's respawn) walking out of where it fell.
  for (const id of store.keys()) {
    if (entities[id]) continue;
    store.delete(id);
    forgetMovement(id);
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
      showHealthChanges(message.payload.healthChanges);
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
