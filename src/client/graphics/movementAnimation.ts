import {
  MOVEMENT_DURATION,
  RUN_MOVEMENT_DURATION,
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
}

export interface AnimatedState {
  position: Position;
  moving: boolean;
}

const movementQueues = new Map<string, MovementStep[]>();
const lastSettle = new Map<string, number>();
const BRIDGE_MS = 60;

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
  if (lastStep) {
    startTime = lastStep.startTime + lastStep.duration;
  } else {
    const now = performance.now();
    const settled = lastSettle.get(playerId);
    const gap = settled !== undefined ? now - settled : Infinity;
    startTime = gap > 0 && gap < BRIDGE_MS ? settled! : now;
  }

  queue.push({ from: lastPos, to, startTime, duration });

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
    return { position: currentPos, moving: false };
  }

  const now = performance.now();
  const step = queue[0];
  const raw = Math.min(Math.max((now - step.startTime) / step.duration, 0), 1);

  if (raw >= 1) {
    queue.shift();
    lastSettle.set(entityId, step.startTime + step.duration);
    return { position: step.to, moving: queue.length > 0 };
  }

  // Smoothstep f(t) = t²(3−2t): velocity is zero at both endpoints, so
  // consecutive steps don't produce visible velocity jumps at transitions.
  const t = raw * raw * (3 - 2 * raw);

  return {
    position: {
      x: step.from.x + (step.to.x - step.from.x) * t,
      y: step.from.y + (step.to.y - step.from.y) * t,
    },
    moving: true,
  };
}
