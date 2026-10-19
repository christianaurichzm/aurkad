import { Direction, type MapType, type PvpMorale } from './types.js';
import { TILE_SIZE } from './constants.js';

export const capitalizeFirst = (s: string) => {
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// A map's PvP morale, deriving from `type` when unset (back-compat).
export const mapPvpMorale = (map: {
  type: MapType;
  pvp?: PvpMorale;
}): PvpMorale => map.pvp ?? (map.type === 'pvp' ? 'no-penalty' : 'safe');

export const mapAllowsPvp = (map: {
  type: MapType;
  pvp?: PvpMorale;
}): boolean => mapPvpMorale(map) !== 'safe';

type Placed = { position: { x: number; y: number } };

/** Whether `target` lies on the side `from` is facing, at any distance. */
export const isFacing = (
  from: Placed & { direction: Direction },
  target: Placed,
): boolean => {
  switch (from.direction) {
    case Direction.Up:
      return target.position.y < from.position.y;
    case Direction.Down:
      return target.position.y > from.position.y;
    case Direction.Left:
      return target.position.x < from.position.x;
    case Direction.Right:
      return target.position.x > from.position.x;
    default:
      return false;
  }
};

type Boxed = Placed & { width: number; height: number };

// Edge to edge along one axis; negative while the two overlap on it.
const gap = (a: number, aSize: number, b: number, bSize: number): number =>
  Math.max(b - (a + aSize), a - (b + bSize));

/**
 * Straight-line distance between two boxes, from tile to nearest tile: for two
 * single tiles, the distance between their positions.
 */
export const reachDistance = (a: Boxed, b: Boxed): number =>
  Math.hypot(
    Math.max(0, gap(a.position.x, a.width, b.position.x, b.width) + TILE_SIZE),
    Math.max(
      0,
      gap(a.position.y, a.height, b.position.y, b.height) + TILE_SIZE,
    ),
  );

/**
 * Whether `to` is straight ahead of `from` within `range`: a melee swing,
 * either way between a player and an npc. Measured box to box, so an npc
 * bigger than a tile is hit from any tile along its near side and hits
 * anyone along it. Neighbours are TILE_SIZE apart, and `range` counts
 * from one tile to the next.
 */
export const inReach = (
  from: Boxed & { direction: Direction },
  to: Boxed,
  range: number,
): boolean => {
  const gapX = gap(from.position.x, from.width, to.position.x, to.width);
  const gapY = gap(from.position.y, from.height, to.position.y, to.height);
  const vertical =
    from.direction === Direction.Up || from.direction === Direction.Down;
  return (
    isFacing(from, to) &&
    (vertical
      ? gapX < 0 && gapY + TILE_SIZE <= range
      : gapY < 0 && gapX + TILE_SIZE <= range)
  );
};

/**
 * Whether pressing interact reaches `npc`: alive, at most a tile away on
 * each axis (diagonals too) and on the side the player faces. The client
 * asks the same before offering the key, so it never offers a dead press.
 */
export const canInteract = (
  player: Placed & { direction: Direction },
  npc: Placed & { health: number },
): boolean =>
  npc.health > 0 &&
  Math.abs(npc.position.x - player.position.x) <= TILE_SIZE &&
  Math.abs(npc.position.y - player.position.y) <= TILE_SIZE &&
  isFacing(player, npc);

/**
 * Nearest-rank percentile of an ascending array; 0 when it is empty. No
 * interpolation, so every value reported is one a tick, frame or login
 * actually took. Tick metrics, the client frame profile and the load test
 * all report through this, so their numbers compare directly.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
