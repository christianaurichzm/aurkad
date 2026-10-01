import { spritePosition } from './camera';
import { entityAtlas, entityAtlasOffsets } from './atlas';
import { getCharacterSpriteCoordinates, getSpriteLayout } from './sprite';
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
  const { width, height } = getSpriteLayout();

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

// The frame hangs from its anchor at the foot of the tile-sized box the rest
// of the client (names, effects, hit flashes) places a character by.
export function drawSprite(
  characterIndex: number,
  column: number,
  row: number,
  posX: number,
  posY: number,
) {
  const { width, height, anchorX, anchorY } = getSpriteLayout();
  const box = spritePosition(posX, posY);

  drawSpriteGeneric(
    playerCtx,
    characterIndex,
    column,
    row,
    box.x + TILE_SIZE / 2 - anchorX,
    box.y + TILE_SIZE - anchorY,
    width,
    height,
  );
}
