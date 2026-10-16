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
 * 0-1-2-1 with three columns (RPG Maker's layout). The anchor is the frame
 * pixel on the foot point, so a frame can be larger than the figure.
 */
type Frames = {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  columns: number;
  idleColumn: number;
  attackColumn: number;
  scale: number;
};

/**
 * A character the grid cannot hold, like a boss three tiles wide, is placed
 * under `characters` by sprite id: `x`/`y` is its block's corner and its
 * frame fields override the sheet's. `rows: 1` faces one way only; `loop`
 * plays the walk cycle while standing too.
 */
export type CharacterBlock = Frames & {
  x: number;
  y: number;
  rows: number;
  loop: boolean;
};

export type SpriteLayout = Frames & {
  characters: Record<string, CharacterBlock>;
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
  characters: {},
};

const frameSide = z.number().int().positive().max(MAX_ISOMETRIC_OVERHANG);
const column = z.number().int().nonnegative();
const FramesSchema = z
  .object({
    width: frameSide,
    height: frameSide,
    anchorX: z.number().nonnegative(),
    anchorY: z.number().nonnegative(),
    columns: z.number().int().min(3).max(32),
    idleColumn: column,
    attackColumn: column,
    scale: z.number().positive().max(4),
  })
  .partial();
const SpriteSheetSchema = FramesSchema.extend({
  characters: z
    .record(
      z.string().regex(/^\d+$/),
      FramesSchema.extend({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        rows: z.union([z.literal(1), z.literal(4)]).optional(),
        loop: z.boolean().optional(),
      }),
    )
    .optional(),
});

// A frame of another size is anchored at its own bottom centre unless told.
function withFrames(base: Frames, given: Partial<Frames>): Frames {
  const width = given.width ?? base.width;
  const height = given.height ?? base.height;
  const resized = width !== base.width || height !== base.height;
  const frames = {
    ...base,
    ...(resized && { anchorX: width / 2, anchorY: height }),
    ...given,
    width,
    height,
  };
  if (
    frames.idleColumn >= frames.columns ||
    frames.attackColumn >= frames.columns
  )
    throw new Error('idleColumn and attackColumn must be frames of the block');
  return frames;
}

/** sprites.json over the defaults; `{}`, no file, is the 64 px grid. */
export function parseSpriteLayout(json: unknown): SpriteLayout {
  const { characters = {}, ...sheet } = SpriteSheetSchema.parse(json);
  const frames = withFrames(DEFAULT_SPRITE_LAYOUT, sheet);
  return {
    ...frames,
    characters: Object.fromEntries(
      Object.entries(characters).map(
        ([id, { x, y, rows = 4, loop = false, ...own }]) => [
          id,
          { ...withFrames(frames, own), x, y, rows, loop },
        ],
      ),
    ),
  };
}

let layout = DEFAULT_SPRITE_LAYOUT;

export const setSpriteLayout = (next: SpriteLayout) => {
  layout = next;
};

export const getSpriteLayout = () => layout;

/** The frames `characterIndex` draws with: its own block's or the sheet's. */
export const characterLayout = (characterIndex: number): Frames =>
  layout.characters[characterIndex] ?? layout;

export function getCharacterSpriteCoordinates(
  characterIndex: number,
  column: number,
  row: number,
  imageWidth: number,
) {
  const own = layout.characters[characterIndex];
  if (own) {
    return {
      x: own.x + column * own.width,
      y: own.y + (own.rows === 1 ? 0 : row) * own.height,
    };
  }

  const blockWidth = layout.width * layout.columns;
  const blockHeight = layout.height * TOTAL_CHARACTER_ROWS;

  const charactersPerRow = Math.max(1, Math.floor(imageWidth / blockWidth));

  const characterColumn = characterIndex % charactersPerRow;
  const characterRow = Math.floor(characterIndex / charactersPerRow);

  const x = characterColumn * blockWidth + column * layout.width;
  const y = characterRow * blockHeight + row * layout.height;

  return { x, y };
}
