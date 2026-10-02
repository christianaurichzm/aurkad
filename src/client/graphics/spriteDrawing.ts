import { spritePosition } from './camera';
import { entityAtlas, entityAtlasOffsets } from './atlas';
import { characterLayout, getCharacterSpriteCoordinates } from './sprite';
import { playerCtx } from './canvas';
import { TILE_SIZE } from '../../shared/constants';

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

/**
 * Where a character's name and health bar go: the top of its box, or of
 * its frame where the frame is taller, so a figure larger than a tile does
 * not wear its name across its chest.
 */
export function spriteTop(
  characterIndex: number,
  posX: number,
  posY: number,
  footprintWidth = TILE_SIZE,
  footprintHeight = TILE_SIZE,
) {
  const { anchorY, scale } = characterLayout(characterIndex);
  const box = spriteBox(posX, posY, footprintWidth, footprintHeight);
  return Math.min(
    spritePosition(posX, posY).y,
    box.y + TILE_SIZE - anchorY * scale,
  );
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
