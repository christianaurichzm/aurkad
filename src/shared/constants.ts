export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 64;
export const TILE_SIZE = 64;
export const ITEM_SIZE = 48;
export const DEFAULT_PLAYER_SPEED = 1;
// Per-tile move durations, used as the client slide time. Kept a little
// BELOW the server's real per-tile cadence (msToTicks rounds up to whole
// ticks: 220 -> 5 ticks = 250ms, 130 -> 3 ticks = 150ms) so each slide
// finishes before the next update and the queue drains every tile. Equal to
// the cadence, the schedule drifts forward while a direction is held and
// eventually freezes or jumps. movementAnimation bridges the small gap this
// leaves, so holding stays smooth.
export const MOVEMENT_DURATION = 220;
export const RUN_MOVEMENT_DURATION = 130;
export const TICK_RATE = 20;
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 896;
export const CHUNK_SIZE = 16;
export const EQUIPMENT_SLOTS = [
  'weapon',
  'helmet',
  'chestplate',
  'gloves',
  'boots',
] as const;
