import {
  MOVEMENT_DURATION,
  RUN_MOVEMENT_DURATION,
  TILE_SIZE,
} from '../../shared/constants';
import {
  CharacterAction,
  Player,
  PlayerPublic,
  Position,
} from '../../shared/types';
import { getGameState, getPlayer } from '../core/gameState';

interface MovementStep {
  from: Position;
  to: Position;
  startTime: number;
  duration: number;
  // False for mid-chain steps, linear so a walk keeps constant speed; true
  // for isolated or first steps, eased in and out.
  eased: boolean;
}

export interface AnimatedState {
  position: Position;
  moving: boolean;
  slideT: number;
}

const movementQueues = new Map<string, MovementStep[]>();
const lastSettle = new Map<string, number>();
// Joins consecutive slides: a new step starts at raw=0 with its duration
// shortened by the gap, so nothing snaps.
const BRIDGE_MS = 100;

export function clearMovementQueues() {
  movementQueues.clear();
  lastSettle.clear();
}

export function onServerPositionUpdate(
  playerId: string,
  from: Position,
  to: Position,
) {
  if (from.x === to.x && from.y === to.y) return;

  // A walk is one tile; anything longer is a placement (warp, respawn, a
  // moderator's move), drawn where it lands rather than slid there.
  if (
    Math.abs(to.x - from.x) > TILE_SIZE ||
    Math.abs(to.y - from.y) > TILE_SIZE
  ) {
    movementQueues.delete(playerId);
    lastSettle.delete(playerId);
    return;
  }

  const queue = movementQueues.get(playerId) || [];
  const lastStep = queue.at(-1);
  const lastPos = lastStep ? lastStep.to : from;

  const gameState = getGameState();
  const clientPlayer = getPlayer();
  let playerState: Player | PlayerPublic | null = null;

  if (gameState?.players?.[playerId]) {
    playerState = gameState.players[playerId];
  } else if (clientPlayer?.id === playerId) {
    playerState = clientPlayer;
  }

  const isRunning = playerState?.action === CharacterAction.Run;
  const duration = isRunning ? RUN_MOVEMENT_DURATION : MOVEMENT_DURATION;

  let startTime: number;
  let eased: boolean;
  let effectiveDuration = duration;

  if (lastStep) {
    startTime = lastStep.startTime + lastStep.duration;
    eased = false;
  } else {
    const now = performance.now();
    const settled = lastSettle.get(playerId);
    const gap = settled !== undefined ? now - settled : Infinity;
    const bridged = gap > 0 && gap < BRIDGE_MS;

    startTime = now;

    if (bridged) {
      // Shortened to keep the server's cadence without snapping the start.
      effectiveDuration = Math.max(
        duration - Math.round(gap),
        Math.round(duration / 2),
      );
      eased = false;
    } else {
      eased = true;
    }
  }

  // Shallow-copy both positions so jsondiffpatch mutations on the live game
  // state object do not corrupt step.from / step.to after the step is queued.
  queue.push({
    from: { ...lastPos },
    to: { ...to },
    startTime,
    duration: effectiveDuration,
    eased,
  });

  const MAX_QUEUE = 6;
  while (queue.length > MAX_QUEUE) {
    const dropped = queue.shift()!;
    for (const step of queue) step.startTime -= dropped.duration;
  }

  movementQueues.set(playerId, queue);
}

export function getAnimatedState(
  entityId: string,
  currentPos: Position,
): AnimatedState {
  const queue = movementQueues.get(entityId);

  if (!queue || queue.length === 0) {
    return { position: currentPos, moving: false, slideT: 0 };
  }

  const now = performance.now();
  const step = queue[0];
  const raw = Math.min(Math.max((now - step.startTime) / step.duration, 0), 1);

  if (raw >= 1) {
    queue.shift();
    lastSettle.set(entityId, step.startTime + step.duration);
    return { position: step.to, moving: queue.length > 0, slideT: 1 };
  }

  // Mid-chain steps are linear for constant speed; isolated or first steps
  // use smoothstep t²(3−2t) to ease in and out.
  const t = step.eased ? raw * raw * (3 - 2 * raw) : raw;

  return {
    // Whole pixels, so the sprite stays on its own grid and does not shimmer;
    // a step moves about four pixels a frame, so rounding does not show.
    position: {
      x: Math.round(step.from.x + (step.to.x - step.from.x) * t),
      y: Math.round(step.from.y + (step.to.y - step.from.y) * t),
    },
    moving: true,
    slideT: t,
  };
}
