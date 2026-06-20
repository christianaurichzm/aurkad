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

export function clearMovementQueues() {
  movementQueues.clear();
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

  // Chain from the previous step's end so a burst of updates plays as one
  // continuous slide. Duration stays below the server's per-tile cadence so the
  // queue always drains instead of drifting into the future (and freezing).
  const startTime = lastStep
    ? lastStep.startTime + lastStep.duration
    : performance.now();

  queue.push({ from: lastPos, to, startTime, duration });

  const MAX_QUEUE = 2;
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

  // Drain every finished step (covers dropped frames), remembering the last so
  // a settled entity holds its final tile.
  let lastPos = currentPos;
  while (queue.length > 0 && now - queue[0].startTime >= queue[0].duration) {
    lastPos = queue.shift()!.to;
  }

  if (queue.length === 0) {
    return { position: lastPos, moving: false };
  }

  const step = queue[0];
  const t = Math.min(Math.max((now - step.startTime) / step.duration, 0), 1);

  return {
    position: {
      x: step.from.x + (step.to.x - step.from.x) * t,
      y: step.from.y + (step.to.y - step.from.y) * t,
    },
    moving: true,
  };
}
