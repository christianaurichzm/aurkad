import { TILE_SIZE } from '../../../shared/constants.js';
import {
  Position,
  Direction,
  CharacterAction,
  CombatTarget,
  PlayerServer,
  RuntimeNpc,
  MapStateServer,
} from '../../../shared/types.js';
import { hasCollision } from '../world/physicsService.js';
import { resolveDamage } from '../combat/index.js';
import { queryEntitiesInRadius } from '../../spatial/spatialManager.js';
import { randomInt } from '../../sim/rng.js';

// Hoisted, since these objects are never mutated.
const WANDER_DIRECTIONS = [
  { dx: 0, dy: -TILE_SIZE, dir: Direction.Up },
  { dx: 0, dy: TILE_SIZE, dir: Direction.Down },
  { dx: -TILE_SIZE, dy: 0, dir: Direction.Left },
  { dx: TILE_SIZE, dy: 0, dir: Direction.Right },
] as const;

// Minimal projection for collision checks. hasCollision only reads
// id/kind/mapId/width/height/position, so this avoids cloning the whole
// RuntimeNpc on the hot path (same pattern as processMovementIntent).
const npcProbe = (npc: RuntimeNpc, x: number, y: number): CombatTarget =>
  ({
    id: npc.id,
    kind: npc.kind,
    mapId: npc.mapId,
    width: npc.width,
    height: npc.height,
    position: { x, y },
  }) as CombatTarget;

export function calculateDirection(
  from: { position: Position },
  to: { position: Position },
) {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;
  const distanceSq = dx * dx + dy * dy;
  return { dx, dy, distanceSq };
}

export function moveNpcTowardsPlayer(
  npc: RuntimeNpc,
  player: PlayerServer,
  map: MapStateServer,
) {
  stepNpcToward(npc, player, map);
}

// Cardinal directions for BFS. Right/Down first so ties resolve toward the
// south-east, which matches the typical RPG "forward" feel.
const BFS_DIRS = [
  { dc: 1, dr: 0, dir: Direction.Right },
  { dc: 0, dr: 1, dir: Direction.Down },
  { dc: -1, dr: 0, dir: Direction.Left },
  { dc: 0, dr: -1, dir: Direction.Up },
] as const;

// BFS on the tile grid returning the first pixel step on the shortest path to
// targetPos. Only static tile blocking is checked here; dynamic entity
// positions are handled by hasCollision at move time.
// Returns null when already at the goal or no reachable path within maxDepth.
function bfsNextStep(
  npcPos: Position,
  targetPos: Position,
  map: MapStateServer,
  maxDepth = 30,
): { x: number; y: number; dir: Direction } | null {
  const sc = Math.floor(npcPos.x / TILE_SIZE);
  const sr = Math.floor(npcPos.y / TILE_SIZE);
  const gc = Math.floor(targetPos.x / TILE_SIZE);
  const gr = Math.floor(targetPos.y / TILE_SIZE);

  if (sc === gc && sr === gr) return null;

  const queue: Array<{
    c: number;
    r: number;
    depth: number;
    first: { x: number; y: number; dir: Direction } | null;
  }> = [{ c: sc, r: sr, depth: 0, first: null }];

  const visited = new Set<number>();
  visited.add(sr * 10000 + sc);

  while (queue.length > 0) {
    const curr = queue.shift()!;

    for (const { dc, dr, dir } of BFS_DIRS) {
      const nc = curr.c + dc;
      const nr = curr.r + dr;
      const key = nr * 10000 + nc;
      if (visited.has(key)) continue;

      const isGoal = nc === gc && nr === gr;
      if (!isGoal) {
        const tile = map.tiles[nr]?.[nc];
        if (!tile || tile.blocked || tile.avoidNpc) continue;
      }

      visited.add(key);
      const first = curr.first ?? { x: nc * TILE_SIZE, y: nr * TILE_SIZE, dir };

      if (isGoal) return first;

      if (curr.depth + 1 < maxDepth) {
        queue.push({ c: nc, r: nr, depth: curr.depth + 1, first });
      }
    }
  }

  return null;
}

// Takes one tile step toward target using BFS-derived optimal path.
export function stepNpcToward(
  npc: RuntimeNpc,
  target: { position: Position },
  map: MapStateServer,
): void {
  if (
    target.position.x === npc.position.x &&
    target.position.y === npc.position.y
  ) {
    npc.action = CharacterAction.Idle;
    return;
  }

  const step = bfsNextStep(npc.position, target.position, map);

  if (!step) {
    npc.action = CharacterAction.Idle;
    return;
  }

  if (!hasCollision(npcProbe(npc, step.x, step.y))) {
    npc.position = { x: step.x, y: step.y };
    npc.direction = step.dir;
    npc.action = CharacterAction.Walk;
  } else {
    // Blocked by an entity; stuckTicks in the caller handles the escape.
    npc.action = CharacterAction.Idle;
  }
}

// Orient the NPC to face the target based on dominant axis. Called before the
// attack-range check each tick so the direction is always current.
export function faceToward(
  npc: RuntimeNpc,
  target: { position: Position },
): void {
  const dx = target.position.x - npc.position.x;
  const dy = target.position.y - npc.position.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    npc.direction = dx >= 0 ? Direction.Right : Direction.Left;
  } else {
    npc.direction = dy >= 0 ? Direction.Down : Direction.Up;
  }
}

// Tries every cardinal direction and takes the first unblocked one, ignoring
// distance ordering, to break out of stuck states where the greedy chase
// path is completely obstructed.
export function escapeMove(npc: RuntimeNpc): void {
  for (const { dx, dy, dir } of WANDER_DIRECTIONS) {
    const nx = npc.position.x + dx;
    const ny = npc.position.y + dy;
    if (!hasCollision(npcProbe(npc, nx, ny))) {
      npc.position = { x: nx, y: ny };
      npc.direction = dir;
      npc.action = CharacterAction.Walk;
      return;
    }
  }
}

export function moveNpcRandomly(npc: RuntimeNpc) {
  const { dx, dy, dir } =
    WANDER_DIRECTIONS[randomInt(WANDER_DIRECTIONS.length)]!;
  const newX = npc.position.x + dx;
  const newY = npc.position.y + dy;

  if (!hasCollision(npcProbe(npc, newX, newY))) {
    npc.position = { x: newX, y: newY };
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
  resolveDamage(player, npc.attack, { attacker: npc });
  npc.action = CharacterAction.Attack;
}

export function findClosestPlayer(
  npc: RuntimeNpc,
  players: PlayerServer[],
): PlayerServer | null {
  if (players.length === 0) return null;

  const SEARCH_RADIUS = 500;
  const nearbyEntities = queryEntitiesInRadius(
    npc.mapId,
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
