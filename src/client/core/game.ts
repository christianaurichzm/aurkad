import { render } from '../graphics/render';
import { getGameState } from './gameState';

const FPS_LIMIT = 60;
const FRAME_DURATION = 1000 / FPS_LIMIT;

let lastTime = 0;
let lastFrameTime = 0;

export const gameLoop = (timestamp: number) => {
  lastTime = timestamp;

  const timeSinceLastFrame = timestamp - lastFrameTime;

  if (timeSinceLastFrame >= FRAME_DURATION) {
    lastFrameTime = timestamp - (timeSinceLastFrame % FRAME_DURATION);

    render(getGameState());
  }

  requestAnimationFrame(gameLoop);
};
