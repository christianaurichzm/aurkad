import { update as updatePlayer } from './player';
import { render } from '../graphics/render';
import { getGameState } from './gameState';

let lastTime = 0;

export const gameLoop = (timestamp: number) => {
  const deltaTime = timestamp - lastTime;
  lastTime = timestamp;

  updatePlayer(deltaTime);
  const { players, enemies } = getGameState();
  render(players, enemies);

  requestAnimationFrame(gameLoop);
};
