import { render } from '../graphics/render';
import { getGameState } from './gameState';

export const gameLoop = () => {
  render(getGameState());

  requestAnimationFrame(gameLoop);
};
