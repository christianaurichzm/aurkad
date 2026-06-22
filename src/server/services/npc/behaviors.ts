import { TILE_SIZE } from '../../../shared/constants.js';
import {
  Position,
  Direction,
  CharacterAction,
  PlayerServer,
  RuntimeNpc,
} from '../../../shared/types.js';
import { hasCollision } from '../physicsService.js';
import { resolveDamage } from '../combat/index.js';
import { queryEntitiesInRadius } from '../../spatial/spatialManager.js';
import { randomInt } from '../../sim/rng.js';
import { logger } from '../../logger.js';

export function calculateDirection(
  from: { position: Position },
  to: { position: Position },
) {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;
  const distanceSq = dx * dx + dy * dy;
  return { dx, dy, distanceSq };
}

export function moveNpcTowardsPlayer(npc: RuntimeNpc, player: PlayerServer) {
  stepNpcToward(npc, player);
}

// One tile-aligned step toward a target position, setting facing direction
// and respecting wall collision (Walk on success, Idle when blocked). It is
// the unit of movement other NPCs use, called at the NPC movement cadence,
// not every tick.
export function stepNpcToward(npc: RuntimeNpc, target: { position: Position }) {
  const { dx, dy } = calculateDirection(npc, target);
  let newX = npc.position.x;
  let newY = npc.position.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    newX += Math.sign(dx) * TILE_SIZE;
    if (!hasCollision({ ...npc, position: { x: newX, y: npc.position.y } })) {
      npc.direction = dx > 0 ? Direction.Right : Direction.Left;
    } else {
      newX = npc.position.x;
      newY += Math.sign(dy) * TILE_SIZE;
      if (!hasCollision({ ...npc, position: { x: npc.position.x, y: newY } })) {
        npc.direction = dy > 0 ? Direction.Down : Direction.Up;
      } else {
        newY = npc.position.y;
      }
    }
  } else {
    newY += Math.sign(dy) * TILE_SIZE;
    if (!hasCollision({ ...npc, position: { x: npc.position.x, y: newY } })) {
      npc.direction = dy > 0 ? Direction.Down : Direction.Up;
    } else {
      newY = npc.position.y;
      newX += Math.sign(dx) * TILE_SIZE;
      if (!hasCollision({ ...npc, position: { x: newX, y: npc.position.y } })) {
        npc.direction = dx > 0 ? Direction.Right : Direction.Left;
      } else {
        newX = npc.position.x;
      }
    }
  }

  const proposed = { ...npc, position: { x: newX, y: newY } };
  if (!hasCollision(proposed)) {
    npc.position = proposed.position;
    npc.action = CharacterAction.Walk;
  } else {
    npc.action = CharacterAction.Idle;
  }

  if (dx === 0) {
    npc.direction = dy > 0 ? Direction.Down : Direction.Up;
  } else if (dy === 0) {
    npc.direction = dx > 0 ? Direction.Right : Direction.Left;
  }
}

export function moveNpcRandomly(npc: RuntimeNpc) {
  const directions = [
    { dx: 0, dy: -TILE_SIZE, dir: Direction.Up },
    { dx: 0, dy: TILE_SIZE, dir: Direction.Down },
    { dx: -TILE_SIZE, dy: 0, dir: Direction.Left },
    { dx: TILE_SIZE, dy: 0, dir: Direction.Right },
  ];

  const { dx, dy, dir } = directions[randomInt(directions.length)]!;
  const newX = npc.position.x + dx;
  const newY = npc.position.y + dy;

  const proposed = { ...npc, position: { x: newX, y: newY } };
  if (!hasCollision(proposed)) {
    npc.position = proposed.position;
    npc.direction = dir;
    npc.action = CharacterAction.Walk;
  } else {
    npc.action = CharacterAction.Idle;
  }
}

export function isPlayerInAttackRange(
  npc: RuntimeNpc,
  player: PlayerServer,
): boolean {
  const { dx, dy, distanceSq } = calculateDirection(npc, player);

  const attackRangeSq = npc.attackRange * npc.attackRange;
  if (distanceSq > attackRangeSq) return false;

  switch (npc.direction) {
    case Direction.Up:
      return dy < 0 && Math.abs(dx) < player.width;
    case Direction.Down:
      return dy > 0 && Math.abs(dx) < player.width;
    case Direction.Left:
      return dx < 0 && Math.abs(dy) < player.height;
    case Direction.Right:
      return dx > 0 && Math.abs(dy) < player.height;
    default:
      return false;
  }
}

export function attackPlayer(npc: RuntimeNpc, player: PlayerServer) {
  void resolveDamage(player, npc.attack, { attacker: npc }).catch((e) => {
    logger.error('resolveDamage failed', { err: e });
  });
  npc.action = CharacterAction.Attack;
}

export function findClosestPlayer(
  npc: RuntimeNpc,
  players: PlayerServer[],
): PlayerServer | null {
  if (players.length === 0) return null;

  const SEARCH_RADIUS = 500;
  const nearbyEntities = queryEntitiesInRadius(
    npc.mapId!,
    npc.position.x,
    npc.position.y,
    SEARCH_RADIUS,
  );

  if (nearbyEntities.length === 0) return null;

  const nearbyPlayers = players.filter((player) =>
    nearbyEntities.some((entity) => entity.id === player.id),
  );

  if (nearbyPlayers.length === 0) return null;

  let closest: PlayerServer | null = null;
  let minDistanceSq = Infinity;

  for (const player of nearbyPlayers) {
    const { distanceSq } = calculateDirection(npc, player);
    if (distanceSq < minDistanceSq) {
      minDistanceSq = distanceSq;
      closest = player;
    }
  }

  return closest;
}
