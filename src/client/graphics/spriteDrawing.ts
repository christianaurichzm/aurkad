import { TILE_SIZE } from '../../shared/constants';
import { entityAtlas, entityAtlasOffsets } from './atlas';
import { getCharacterSpriteCoordinates, getSpriteSize } from './sprite';
import { playerCtx } from './canvas';

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
  const off = entityAtlasOffsets.sprites!;
  const { x, y } = getCharacterSpriteCoordinates(
    characterIndex,
    column,
    row,
    off.width,
  );
  const { SPRITE_WIDTH, SPRITE_HEIGHT } = getSpriteSize();

  ctx.drawImage(
    entityAtlas,
    off.x + x,
    off.y + y,
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
