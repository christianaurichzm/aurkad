import { render } from '../graphics/render';
import { updateWebSocket } from '../io/network';
import { getGameState } from './gameState';

export const gameLoop = () => {
  updateWebSocket();
  render(getGameState());
  requestAnimationFrame(gameLoop);
};
