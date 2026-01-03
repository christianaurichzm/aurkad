import {
  MOVEMENT_DURATION,
  RUN_MOVEMENT_DURATION,
} from '../../shared/constants';
import { CharacterAction, Player, PlayerPublic, Position } from '../../shared/types';
import { getGameState, getPlayer } from '../core/gameState';

interface MovementStep {
  from: Position;
  to: Position;
  startTime: number;
  duration: number;
}

const movementQueues = new Map<string, MovementStep[]>();

export function onServerPositionUpdate(
  playerId: string,
  from: Position,
  to: Position,
) {
  if (from.x === to.x && from.y === to.y) return;

  const queue = movementQueues.get(playerId) || [];
  const lastPos = queue.length > 0 ? queue[queue.length - 1].to : from;

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

  queue.push({
    from: lastPos,
    to,
    startTime: performance.now(),
    duration: duration,
  });

  movementQueues.set(playerId, queue);
}

export function getAnimatedPosition(playerId: string): Position {
  const queue = movementQueues.get(playerId);

  const gameState = getGameState();
  const localPlayer = getPlayer();
  let player: Player | PlayerPublic | null = null;
  if (gameState?.players?.[playerId]) {
    player = gameState.players[playerId];
  } else if (localPlayer?.id === playerId) {
    player = localPlayer;
  }

  if (!queue || queue.length === 0) {
    return player ? player.position : { x: 0, y: 0 };
  }

  const step = queue[0];
  const now = performance.now();
  const elapsed = now - step.startTime;
  const t = Math.min(elapsed / step.duration, 1);

  const x = step.from.x + (step.to.x - step.from.x) * t;
  const y = step.from.y + (step.to.y - step.from.y) * t;

  if (t >= 1) {
    queue.shift();
    movementQueues.set(playerId, queue);

    return step.to;
  }

  return { x, y };
}
