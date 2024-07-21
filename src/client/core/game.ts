import { renderInventory } from '../graphics/inventory';
import { render } from '../graphics/render';
import { updateWebSocket } from '../io/network';
import { getGameState, getPlayer } from './gameState';

export const gameLoop = () => {
  updateWebSocket();
  render();
  requestAnimationFrame(gameLoop);
};
