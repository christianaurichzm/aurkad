import { TILE_SIZE } from '../../shared/constants';
import { spriteSheet } from '../io/files';
import { getCharacterSpriteCoordinates, getSpriteSize } from './sprite';
import { playerCtx } from './canvas';

/**
 * Draws a sprite from the spritesheet onto any canvas context, at any
 * size and position.
 *
 * @param ctx The target CanvasRenderingContext2D
 * @param characterIndex Index of the sprite in the spritesheet
 * @param column Animation frame column (usually 0 for static previews)
 * @param row Animation frame row (usually 0 for static previews)
 * @param destX Destination X coordinate on the canvas
 * @param destY Destination Y coordinate on the canvas
 * @param destW Destination width (canvas.width for previews, SPRITE_WIDTH
 *   in play)
 * @param destH Destination height (canvas.height for previews,
 *   SPRITE_HEIGHT in play)
 */
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
  const { x, y } = getCharacterSpriteCoordinates(
    characterIndex,
    column,
    row,
    spriteSheet.width,
  );
  const { SPRITE_WIDTH, SPRITE_HEIGHT } = getSpriteSize();

  ctx.drawImage(
    spriteSheet,
    x,
    y,
    SPRITE_WIDTH,
    SPRITE_HEIGHT,
    destX,
    destY,
    destW,
    destH,
  );
}

export function drawSprite(
  characterIndex: number,
  column: number,
  row: number,
  posX: number,
  posY: number,
) {
  const ctx = playerCtx;
  const { SPRITE_WIDTH, SPRITE_HEIGHT } = getSpriteSize();
  const offsetX = (TILE_SIZE - SPRITE_WIDTH) / 2;
  const offsetY = (TILE_SIZE - SPRITE_HEIGHT) / 2;

  drawSpriteGeneric(
    ctx,
    characterIndex,
    column,
    row,
    posX + offsetX,
    posY + offsetY,
    SPRITE_WIDTH,
    SPRITE_HEIGHT,
  );
}
