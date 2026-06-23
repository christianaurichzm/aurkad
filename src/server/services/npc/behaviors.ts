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

// Hoisted, since these objects are never mutated.
const WANDER_DIRECTIONS = [
  { dx: 0, dy: -TILE_SIZE, dir: Direction.Up },
  { dx: 0, dy: TILE_SIZE, dir: Direction.Down },
  { dx: -TILE_SIZE, dy: 0, dir: Direction.Left },
  { dx: TILE_SIZE, dy: 0, dir: Direction.Right },
] as const;

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

// One tile-aligned step toward a target position. Tries the 4 cardinal
// directions sorted by the Manhattan distance they leave to the goal, and
// takes the first that does not collide.
//
// Sort tiebreaker: among equal-distance directions, the direction opposite the
// dominant axis is deprioritised so NPCs prefer perpendicular movement over
// retreating when wall-hugging.
//
// Adjacent guard: when the target is already on an adjacent tile (≤ TILE_SIZE
// away), alternative directions are suppressed: the NPC faces the target and
// waits rather than routing sideways around it, which keeps it in attack
// position instead of drifting away when the player blocks it.
export function stepNpcToward(npc: RuntimeNpc, target: { position: Position }) {
  const dx = target.position.x - npc.position.x;
  const dy = target.position.y - npc.position.y;

  if (dx === 0 && dy === 0) {
    npc.action = CharacterAction.Idle;
    return;
  }

  const px = npc.position.x;
  const py = npc.position.y;
  const currentDist = Math.abs(dx) + Math.abs(dy);
  const adjacent = currentDist <= TILE_SIZE;

  // Steps and their resulting Manhattan distance to goal
  const steps = [
    {
      nx: px + TILE_SIZE,
      ny: py,
      dist: Math.abs(dx - TILE_SIZE) + Math.abs(dy),
    },
    {
      nx: px - TILE_SIZE,
      ny: py,
      dist: Math.abs(dx + TILE_SIZE) + Math.abs(dy),
    },
    {
      nx: px,
      ny: py + TILE_SIZE,
      dist: Math.abs(dx) + Math.abs(dy - TILE_SIZE),
    },
    {
      nx: px,
      ny: py - TILE_SIZE,
      dist: Math.abs(dx) + Math.abs(dy + TILE_SIZE),
    },
  ];

  // Penalise the direction that opposes the dominant axis so perpendicular
  // movement is tried before retreating (tiebreaker on equal dist values).
  const isBackward = (nx: number, ny: number): boolean =>
    Math.abs(dx) >= Math.abs(dy) ? (nx - px) * dx < 0 : (ny - py) * dy < 0;

  steps.sort((a, b) =>
    a.dist !== b.dist
      ? a.dist - b.dist
      : (isBackward(a.nx, a.ny) ? 1 : 0) - (isBackward(b.nx, b.ny) ? 1 : 0),
  );

  for (const { nx, ny, dist } of steps) {
    // When the target is on an adjacent tile, skip any step that increases
    // distance: the NPC should face the target and wait, not route around it.
    if (adjacent && dist > currentDist) continue;

    if (!hasCollision({ ...npc, position: { x: nx, y: ny } })) {
      const mdx = nx - px;
      const mdy = ny - py;
      npc.position = { x: nx, y: ny };
      npc.direction =
        mdx > 0
          ? Direction.Right
          : mdx < 0
            ? Direction.Left
            : mdy > 0
              ? Direction.Down
              : Direction.Up;
      npc.action = CharacterAction.Walk;
      return;
    }
  }

  // Stuck: face the target even when blocked, so the NPC "looks at" its goal.
  if (Math.abs(dx) >= Math.abs(dy)) {
    npc.direction = dx > 0 ? Direction.Right : Direction.Left;
  } else {
    npc.direction = dy > 0 ? Direction.Down : Direction.Up;
  }
  npc.action = CharacterAction.Idle;
}

export function moveNpcRandomly(npc: RuntimeNpc) {
  const { dx, dy, dir } =
    WANDER_DIRECTIONS[randomInt(WANDER_DIRECTIONS.length)]!;
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

  // O(k) Set lookup instead of O(k × m) nested .some()
  const nearbyIds = new Set(nearbyEntities.map((e) => e.id));
  const nearbyPlayers = players.filter((p) => nearbyIds.has(p.id));

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
