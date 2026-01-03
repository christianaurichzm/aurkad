import { ITEM_SIZE } from '../../shared/constants';

export const getSpriteCoordinates = (spriteId: number, sheetWidth: number) => {
  const cols = sheetWidth / ITEM_SIZE;
  const x = (spriteId % cols) * ITEM_SIZE;
  const y = Math.floor(spriteId / cols) * ITEM_SIZE;
  return { x, y };
};
