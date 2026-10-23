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
import { hasCollision, tileBlocks } from '../world/physicsService.js';
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
// `avoid` the cells it found occupied. Tiles are judged for `walker` by
// tileBlocks: `avoidNpc` fences npcs in, and a script's conditionalBlock
// lets players by.
export function bfsNextStep(
  npcPos: Position,
  targetPos: Position,
  map: MapStateServer,
  maxDepth: number,
  walker: CombatTarget,
  avoid: readonly Position[] = [],
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
        if (!tile || tileBlocks(tile, walker)) continue;
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

export type PathStep = { x: number; y: number; dir: Direction };

// findPath's search state, over a square of side 2 * maxDepth + 1 centred on
// the start: no cell a walk of maxDepth reaches lies outside it, so the
// buffers are sized by the depth, never the map, and kept between searches.
// Stamped with a generation instead of cleared.
let searchSide = 0;
let reached = new Int32Array(0);
let expanded = new Int32Array(0);
let avoided = new Int32Array(0);
let costTo = new Int32Array(0);
let cameFrom = new Int32Array(0);
// A cell is queued again each time a shorter way to it turns up, at most
// once per neighbour.
let frontier = new Int32Array(0);
let nextFrontier = new Int32Array(0);
let generation = 0;

function prepareSearch(maxDepth: number): void {
  const side = 2 * maxDepth + 1;
  if (side > searchSide) {
    const cells = side * side;
    reached = new Int32Array(cells);
    expanded = new Int32Array(cells);
    avoided = new Int32Array(cells);
    costTo = new Int32Array(cells);
    cameFrom = new Int32Array(cells);
    frontier = new Int32Array(4 * cells);
    nextFrontier = new Int32Array(4 * cells);
    searchSide = side;
    generation = 0;
  }
  if (++generation === 0x7fffffff) {
    reached.fill(0);
    expanded.fill(0);
    avoided.fill(0);
    generation = 1;
  }
}

/**
 * Every step of a shortest way to `targetPos`, the goal last, or null at the
 * goal or with none within maxDepth. The rules are bfsNextStep's, which is
 * asked again every step; this is asked once for a whole walk. A* with the
 * Manhattan distance, which on a four-way grid moves each cell's estimate by
 * 0 or 2, so two queues stand in for a priority queue.
 */
export function findPath(
  fromPos: Position,
  targetPos: Position,
  map: MapStateServer,
  maxDepth: number,
  walker: CombatTarget,
  avoid: readonly Position[] = [],
): PathStep[] | null {
  const sc = Math.floor(fromPos.x / TILE_SIZE);
  const sr = Math.floor(fromPos.y / TILE_SIZE);
  const gc = Math.floor(targetPos.x / TILE_SIZE);
  const gr = Math.floor(targetPos.y / TILE_SIZE);
  const estimate = (c: number, r: number) =>
    Math.abs(c - gc) + Math.abs(r - gr);
  if (sc === gc && sr === gr) return null;
  if (estimate(sc, sr) > maxDepth) return null;

  prepareSearch(maxDepth);
  const side = 2 * maxDepth + 1;
  const cellAt = (c: number, r: number) =>
    (r - sr + maxDepth) * side + (c - sc + maxDepth);
  const gen = generation;

  for (const { x, y } of avoid) {
    const ac = Math.floor(x / TILE_SIZE);
    const ar = Math.floor(y / TILE_SIZE);
    if (
      (ac !== gc || ar !== gr) &&
      Math.abs(ac - sc) <= maxDepth &&
      Math.abs(ar - sr) <= maxDepth
    )
      avoided[cellAt(ac, ar)] = gen;
  }

  let now = frontier;
  let later = nextFrontier;
  let nowLength = 0;
  let laterLength = 0;
  const start = cellAt(sc, sr);
  reached[start] = gen;
  costTo[start] = 0;
  now[nowLength++] = start;
  let bound = estimate(sc, sr);

  while (nowLength > 0) {
    for (let i = 0; i < nowLength; i++) {
      const cell = now[i]!;
      if (expanded[cell] === gen) continue;
      expanded[cell] = gen;
      const cost = costTo[cell]! + 1;
      const c = (cell % side) - maxDepth + sc;
      const r = Math.floor(cell / side) - maxDepth + sr;

      for (const { dc, dr } of BFS_DIRS) {
        const nc = c + dc;
        const nr = r + dr;
        const next = cell + dr * side + dc;
        if (expanded[next] === gen) continue;

        // Reached from a cell of the lowest estimate left, so the shortest.
        if (nc === gc && nr === gr) {
          cameFrom[next] = cell;
          return stepsTo(next, cost, side, maxDepth, sc, sr);
        }
        if (avoided[next] === gen) continue;
        const tile = map.tiles[nr]?.[nc];
        if (!tile || tileBlocks(tile, walker)) continue;
        if (cost >= maxDepth) continue;
        if (reached[next] === gen && costTo[next]! <= cost) continue;

        reached[next] = gen;
        costTo[next] = cost;
        cameFrom[next] = cell;
        if (cost + estimate(nc, nr) === bound) now[nowLength++] = next;
        else later[laterLength++] = next;
      }
    }
    [now, later] = [later, now];
    nowLength = laterLength;
    laterLength = 0;
    bound += 2;
  }
  return null;
}

function stepsTo(
  goal: number,
  length: number,
  side: number,
  maxDepth: number,
  sc: number,
  sr: number,
): PathStep[] {
  const steps = new Array<PathStep>(length);
  let cell = goal;
  for (let i = length - 1; i >= 0; i--) {
    const from = cameFrom[cell]!;
    const delta = cell - from;
    steps[i] = {
      x: ((cell % side) - maxDepth + sc) * TILE_SIZE,
      y: (Math.floor(cell / side) - maxDepth + sr) * TILE_SIZE,
      dir:
        delta === 1
          ? Direction.Right
          : delta === -1
            ? Direction.Left
            : delta > 0
              ? Direction.Down
              : Direction.Up,
    };
    cell = from;
  }
  return steps;
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
      ? bfsNextStep(npc.position, target.position, map, depth, npc)
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
  map: MapStateServer,
  radiusPx: number,
): PlayerServer | null {
  const nearbyEntities = queryEntitiesInRadius(
    npc.mapId,
    npc.position.x,
    npc.position.y,
    radiusPx,
  );

  let closest: PlayerServer | null = null;
  // The quadtree query is the broad phase (it answers by node box), so the
  // radius only becomes the sight radius after this exact check.
  let minDistanceSq = radiusPx * radiusPx;

  for (const entity of nearbyEntities) {
    // The tree is rebuilt once a tick: a player in it may have died or left
    // this map since, and only one still standing on it counts.
    const player = entity.kind === 'player' ? map.players[entity.id!] : null;
    if (!player || player !== entity || player.health <= 0) continue;
    const { distanceSq } = calculateDirection(npc, player);
    if (distanceSq <= minDistanceSq) {
      minDistanceSq = distanceSq;
      closest = player;
    }
  }

  return closest;
}
