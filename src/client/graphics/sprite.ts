import { changeSprite } from '../io/network';
import { SPRITE_HEIGHT, SPRITE_WIDTH } from '../../shared/constants';

const TOTAL_CHARACTER_ROWS = 4;
const TOTAL_CHARACTER_COLUMNS = 4;

export function getCharacterSpriteCoordinates(
  characterIndex: number,
  column: number,
  row: number,
  imageWidth: number,
) {
  const BLOCK_WIDTH = SPRITE_WIDTH * TOTAL_CHARACTER_COLUMNS;
  const BLOCK_HEIGHT = SPRITE_HEIGHT * TOTAL_CHARACTER_ROWS;

  const charactersPerRow = Math.floor(imageWidth / BLOCK_WIDTH);

  const characterColumn = characterIndex % charactersPerRow;
  const characterRow = Math.floor(characterIndex / charactersPerRow);

  const x = characterColumn * BLOCK_WIDTH + column * SPRITE_WIDTH;
  const y = characterRow * BLOCK_HEIGHT + row * SPRITE_HEIGHT;

  return { x, y };
}

export const getSpriteSize = () => {
  return { SPRITE_WIDTH, SPRITE_HEIGHT };
};

document.addEventListener('DOMContentLoaded', () => {
  const saveSprite = document.getElementById('saveSprite');
  if (saveSprite) {
    saveSprite.addEventListener('click', (e) => {
      e.preventDefault();
      const spriteInput = document.getElementById('sprite');
      if (spriteInput && spriteInput instanceof HTMLInputElement) {
        const spriteId = parseInt(spriteInput.value, 10);
        changeSprite(spriteId)
          .then(() => {
            console.log('Sprite changed successfully');
          })
          .catch((error) => {
            console.error('Error changing sprite:', error);
          });
      } else {
        console.error('Sprite input not found');
      }
    });
  } else {
    console.error('Change sprite button not found');
  }
});
