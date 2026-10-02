import { z } from 'zod';
import {
  MAX_ISOMETRIC_OVERHANG,
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
} from '../../shared/constants';

const TOTAL_CHARACTER_ROWS = 4;

/**
 * How a game's sprites.png is cut, from assets/sprites.json. A character is
 * four rows (directions) of `columns` frames; the first four are the walk,
 * and idle and attack name the frames those actions hold. The anchor is the
 * frame pixel on the foot point, so a frame can be larger than the figure.
 */
export type SpriteLayout = {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  columns: number;
  idleColumn: number;
  attackColumn: number;
  scale: number;
};

export const DEFAULT_SPRITE_LAYOUT: SpriteLayout = {
  width: SPRITE_WIDTH,
  height: SPRITE_HEIGHT,
  anchorX: SPRITE_WIDTH / 2,
  anchorY: SPRITE_HEIGHT,
  columns: 4,
  idleColumn: 0,
  attackColumn: 2,
  scale: 1,
};

const frameSide = z.number().int().positive().max(MAX_ISOMETRIC_OVERHANG);
const column = z.number().int().nonnegative();
const SpriteLayoutSchema = z
  .object({
    width: frameSide,
    height: frameSide,
    anchorX: z.number().nonnegative(),
    anchorY: z.number().nonnegative(),
    columns: z.number().int().min(4).max(32),
    idleColumn: column,
    attackColumn: column,
    scale: z.number().positive().max(4),
  })
  .partial()
  .refine(
    (l) =>
      (l.idleColumn ?? 0) < (l.columns ?? 4) &&
      (l.attackColumn ?? 2) < (l.columns ?? 4),
    'idleColumn and attackColumn must be frames of the block',
  );

/** sprites.json over the defaults; `{}`, no file, is the 64 px grid. */
export function parseSpriteLayout(json: unknown): SpriteLayout {
  const given = SpriteLayoutSchema.parse(json);
  const width = given.width ?? DEFAULT_SPRITE_LAYOUT.width;
  const height = given.height ?? DEFAULT_SPRITE_LAYOUT.height;
  return {
    ...DEFAULT_SPRITE_LAYOUT,
    anchorX: width / 2,
    anchorY: height,
    ...given,
    width,
    height,
  };
}

let layout = DEFAULT_SPRITE_LAYOUT;

export const setSpriteLayout = (next: SpriteLayout) => {
  layout = next;
};

export const getSpriteLayout = () => layout;

export function getCharacterSpriteCoordinates(
  characterIndex: number,
  column: number,
  row: number,
  imageWidth: number,
) {
  const blockWidth = layout.width * layout.columns;
  const blockHeight = layout.height * TOTAL_CHARACTER_ROWS;

  const charactersPerRow = Math.max(1, Math.floor(imageWidth / blockWidth));

  const characterColumn = characterIndex % charactersPerRow;
  const characterRow = Math.floor(characterIndex / charactersPerRow);

  const x = characterColumn * blockWidth + column * layout.width;
  const y = characterRow * blockHeight + row * layout.height;

  return { x, y };
}
