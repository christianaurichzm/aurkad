import { spritePosition } from './camera';
import { entityAtlas, entityAtlasOffsets } from './atlas';
import { characterLayout, getCharacterSpriteCoordinates } from './sprite';
import { playerCtx } from './canvas';
import { TILE_SIZE } from '../../shared/constants';
import { Direction } from '../../shared/types';

export function drawSpriteGeneric(
  ctx: CanvasRenderingContext2D,
  characterIndex: number,
  column: number,
  row: number,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
) {
  if (!entityAtlas) return;
  const off = entityAtlasOffsets.sprites;
  if (!off) return;
  const { x, y } = getCharacterSpriteCoordinates(
    characterIndex,
    column,
    row,
    off.width,
  );
  const { width, height } = characterLayout(characterIndex);

  ctx.drawImage(
    entityAtlas,
    off.x + x,
    off.y + y,
    width,
    height,
    destX,
    destY,
    destW,
    destH,
  );
}

// The tile-sized box names, effects and hit flashes place a character by.
// A character bigger than a tile is centred on its whole footprint.
const spriteBox = (
  posX: number,
  posY: number,
  footprintWidth: number,
  footprintHeight: number,
) =>
  spritePosition(
    posX + (footprintWidth - TILE_SIZE) / 2,
    posY + footprintHeight - TILE_SIZE,
  );

export interface FigureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Where the figure stands in its frame: the opaque part of its standing
// frame facing down. Sheets leave different room around a figure, so names
// and portraits go by this. Read once per character.
const figures = new Map<number, FigureBounds>();
let figuresOf: HTMLCanvasElement | null = null;

export function figureBounds(characterIndex: number): FigureBounds {
  const { width, height, idleColumn } = characterLayout(characterIndex);
  const frame = { x: 0, y: 0, width, height };
  const off = entityAtlasOffsets.sprites;
  if (!entityAtlas || !off) return frame;
  if (figuresOf !== entityAtlas) {
    figures.clear();
    figuresOf = entityAtlas;
  }
  const known = figures.get(characterIndex);
  if (known) return known;

  const at = getCharacterSpriteCoordinates(
    characterIndex,
    idleColumn,
    Direction.Down,
    off.width,
  );
  const { data } = entityAtlas
    .getContext('2d')!
    .getImageData(off.x + at.x, off.y + at.y, width, height);
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const figure =
    right < 0
      ? frame
      : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  figures.set(characterIndex, figure);
  return figure;
}

/** Where a character's name and health bar go: the top of its head. */
export function spriteTop(
  characterIndex: number,
  posX: number,
  posY: number,
  footprintWidth = TILE_SIZE,
  footprintHeight = TILE_SIZE,
) {
  const { anchorY, scale } = characterLayout(characterIndex);
  const box = spriteBox(posX, posY, footprintWidth, footprintHeight);
  const head = figureBounds(characterIndex).y;
  return box.y + TILE_SIZE - (anchorY - head) * scale;
}

// The frame hangs from its anchor at the foot of the character's box.
export function drawSprite(
  characterIndex: number,
  column: number,
  row: number,
  posX: number,
  posY: number,
  footprintWidth = TILE_SIZE,
  footprintHeight = TILE_SIZE,
) {
  const { width, height, anchorX, anchorY, scale } =
    characterLayout(characterIndex);
  const box = spriteBox(posX, posY, footprintWidth, footprintHeight);

  drawSpriteGeneric(
    playerCtx,
    characterIndex,
    column,
    row,
    box.x + TILE_SIZE / 2 - anchorX * scale,
    box.y + TILE_SIZE - anchorY * scale,
    width * scale,
    height * scale,
  );
}
