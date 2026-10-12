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
import { resolveDamage, swing } from '../combat/index.js';
import { queryEntitiesInRadius } from '../../sim/spatialManager.js';
import { randomInt } from '../../sim/rng.js';
import { inReach } from '../../../shared/utils.js';

// Hoisted, since these objects are never mutated.
const WANDER_DIRECTIONS = [
  { dx: 0, dy: -TILE_SIZE, dir: Direction.Up },
  { dx: 0, dy: TILE_SIZE, dir: Direction.Down },
  { dx: -TILE_SIZE, dy: 0, dir: Direction.Left },
  { dx: TILE_SIZE, dy: 0, dir: Direction.Right },
] as const;

// Minimal projection for collision checks. hasCollision only reads
// id/kind/solid/mapId/width/height/position, so this avoids cloning the whole
// RuntimeNpc on the hot path (same pattern as processMovementIntent).
const npcProbe = (npc: RuntimeNpc, x: number, y: number): CombatTarget =>
  ({
    id: npc.id,
    kind: npc.kind,
    solid: npc.solid,
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

// How far the path search looks when the npc does not say otherwise. Content
// lowers it for a dumb animal and raises it for a hunter; 0 means no search at
// all (see greedyStep).
export const DEFAULT_PATH_DEPTH = 30;

// Cardinal directions for BFS. Right/Down first so ties resolve toward the
// south-east, which matches the typical RPG "forward" feel.
const BFS_DIRS = [
  { dc: 1, dr: 0, dir: Direction.Right },
  { dc: 0, dr: 1, dir: Direction.Down },
  { dc: -1, dr: 0, dir: Direction.Left },
  { dc: 0, dr: -1, dir: Direction.Up },
] as const;

// BFS on the tile grid returning the first pixel step on the shortest path
// to targetPos, or null at the goal or with no path within maxDepth. Only
// static tiles block here; entities are checked by hasCollision at move
// time. A player walking to a clicked cell takes the same path, passing in
// `avoid` the cells it found occupied, and `forNpc` false: `avoidNpc` fences
// npcs in and lets players through, as collision does (isTileBlocked).
export function bfsNextStep(
  npcPos: Position,
  targetPos: Position,
  map: MapStateServer,
  maxDepth: number,
  avoid: readonly Position[] = [],
  forNpc = true,
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
  for (const { x, y } of avoid) {
    const ac = Math.floor(x / TILE_SIZE);
    const ar = Math.floor(y / TILE_SIZE);
    if (ac !== gc || ar !== gr) visited.add(ar * 10000 + ac);
  }

  // A read index rather than shift(): an unreachable target floods the whole
  // depth, and shifting that frontier makes the search quadratic.
  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++]!;

    for (const { dc, dr, dir } of BFS_DIRS) {
      const nc = curr.c + dc;
      const nr = curr.r + dr;
      const key = nr * 10000 + nc;
      if (visited.has(key)) continue;

      const isGoal = nc === gc && nr === gr;
      if (!isGoal) {
        const tile = map.tiles[nr]?.[nc];
        if (!tile || tile.blocked || (forNpc && tile.avoidNpc)) continue;
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

// One step along the dominant axis, with no idea what a wall is. This is what
// pathDepth 0 buys: the caller's collision check stops the step and the stuck
// counter makes the npc shuffle, which is what an unintelligent chase looks
// like from the outside.
function greedyStep(
  npcPos: Position,
  targetPos: Position,
): { x: number; y: number; dir: Direction } | null {
  const dx = targetPos.x - npcPos.x;
  const dy = targetPos.y - npcPos.y;
  if (dx === 0 && dy === 0) return null;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const dir = dx > 0 ? Direction.Right : Direction.Left;
    return { x: npcPos.x + Math.sign(dx) * TILE_SIZE, y: npcPos.y, dir };
  }
  const dir = dy > 0 ? Direction.Down : Direction.Up;
  return { x: npcPos.x, y: npcPos.y + Math.sign(dy) * TILE_SIZE, dir };
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

  const depth = npc.pathDepth ?? DEFAULT_PATH_DEPTH;
  const step =
    depth > 0
      ? bfsNextStep(npc.position, target.position, map, depth)
      : greedyStep(npc.position, target.position);

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

// Faces the NPC toward the target along the dominant axis, before the
// attack-range check each tick. Centre to centre, so an npc bigger than a
// tile turns to whichever side the target is on.
export function faceToward(npc: RuntimeNpc, target: CombatTarget): void {
  const dx =
    target.position.x + target.width / 2 - (npc.position.x + npc.width / 2);
  const dy =
    target.position.y + target.height / 2 - (npc.position.y + npc.height / 2);
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
  return inReach(npc, player, npc.attackRange);
}

export function attackPlayer(npc: RuntimeNpc, player: PlayerServer) {
  resolveDamage(player, npc.attack, { attacker: npc });
  swing(npc);
}

export function findClosestPlayer(
  npc: RuntimeNpc,
  players: PlayerServer[],
  radiusPx: number,
): PlayerServer | null {
  if (players.length === 0) return null;

  const nearbyEntities = queryEntitiesInRadius(
    npc.mapId,
    npc.position.x,
    npc.position.y,
    radiusPx,
  );

  if (nearbyEntities.length === 0) return null;

  // O(k) Set lookup instead of O(k × m) nested .some()
  const nearbyIds = new Set(nearbyEntities.map((e) => e.id));
  const nearbyPlayers = players.filter((p) => nearbyIds.has(p.id));

  if (nearbyPlayers.length === 0) return null;

  let closest: PlayerServer | null = null;
  // The quadtree query is the broad phase (it answers by node box), so the
  // radius only becomes the sight radius after this exact check.
  let minDistanceSq = radiusPx * radiusPx;

  for (const player of nearbyPlayers) {
    const { distanceSq } = calculateDirection(npc, player);
    if (distanceSq <= minDistanceSq) {
      minDistanceSq = distanceSq;
      closest = player;
    }
  }

  return closest;
}
