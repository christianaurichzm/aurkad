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
