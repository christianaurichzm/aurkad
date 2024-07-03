import { changeSprite } from '../io/network';
import { SPRITE_HEIGHT, SPRITE_WIDTH } from '../../shared/constants';

const TOTAL_CHARACTER_ROWS = 4;
const TOTAL_CHARACTER_COLUMNS = 4;
const CHARACTERS_PER_INDEX = TOTAL_CHARACTER_ROWS + TOTAL_CHARACTER_COLUMNS;

export function getCharacterSpriteCoordinates(
  characterIndex: number,
  column: number,
  row: number,
) {
  const characterRow = Math.floor(characterIndex / CHARACTERS_PER_INDEX);
  const characterColumn = characterIndex % CHARACTERS_PER_INDEX;

  const x =
    characterColumn * TOTAL_CHARACTER_COLUMNS * SPRITE_WIDTH +
    column * SPRITE_WIDTH;
  const y =
    characterRow * TOTAL_CHARACTER_ROWS * SPRITE_HEIGHT + row * SPRITE_HEIGHT;

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
