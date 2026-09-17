import { ITEM_SIZE, TILE_SIZE } from '../../shared/constants';
import { entityAtlas, entityAtlasOffsets } from './atlas';
import { getSpriteCoordinates } from './spriteCoordinates';

export const renderItemIcon = (
  ctx: CanvasRenderingContext2D,
  spriteId: number,
  x: number,
  y: number,
  applyOffset: boolean = true,
) => {
  if (!entityAtlas) return;
  const off = entityAtlasOffsets.items;
  if (!off) return;
  const { x: spriteX, y: spriteY } = getSpriteCoordinates(spriteId, off.width);
  const offsetX = applyOffset ? (TILE_SIZE - ITEM_SIZE) / 2 : 0;
  const offsetY = applyOffset ? (TILE_SIZE - ITEM_SIZE) / 2 : 0;

  ctx.drawImage(
    entityAtlas,
    off.x + spriteX,
    off.y + spriteY,
    ITEM_SIZE,
    ITEM_SIZE,
    x + offsetX,
    y + offsetY,
    ITEM_SIZE,
    ITEM_SIZE,
  );
};

export function drawItemGeneric(
  ctx: CanvasRenderingContext2D,
  spriteId: number,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
) {
  if (!entityAtlas) return;
  const off = entityAtlasOffsets.items;
  if (!off) return;
  const { x: spriteX, y: spriteY } = getSpriteCoordinates(spriteId, off.width);

  ctx.drawImage(
    entityAtlas,
    off.x + spriteX,
    off.y + spriteY,
    ITEM_SIZE,
    ITEM_SIZE,
    destX,
    destY,
    destW,
    destH,
  );
}
