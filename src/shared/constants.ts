export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 64;
export const TILE_SIZE = 64;
export const ITEM_SIZE = 48;
export const DEFAULT_PLAYER_SPEED = 1;
// 2ms below server cadence (250ms) so each slide drains before the next tick.
export const MOVEMENT_DURATION = 248;
export const RUN_MOVEMENT_DURATION = 148;
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
