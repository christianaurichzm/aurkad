import { ITEM_SIZE, TILE_SIZE } from '../../shared/constants';
import { items } from '../io/files';
import { getSpriteCoordinates } from './spriteCoordinates';

export const renderItemIcon = (
  ctx: CanvasRenderingContext2D,
  spriteId: number,
  x: number,
  y: number,
  applyOffset: boolean = true,
) => {
  const { x: spriteX, y: spriteY } = getSpriteCoordinates(
    spriteId,
    items?.width,
  );

  const offsetX = applyOffset ? (TILE_SIZE - ITEM_SIZE) / 2 : 0;
  const offsetY = applyOffset ? (TILE_SIZE - ITEM_SIZE) / 2 : 0;

  ctx.drawImage(
    items,
    spriteX,
    spriteY,
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
  const { x: spriteX, y: spriteY } = getSpriteCoordinates(
    spriteId,
    items.naturalWidth,
  );

  ctx.drawImage(
    items,
    spriteX,
    spriteY,
    ITEM_SIZE,
    ITEM_SIZE,
    destX,
    destY,
    destW,
    destH,
  );
}
