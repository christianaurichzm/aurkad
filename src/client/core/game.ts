import { render } from '../graphics/render';
import { updateChat, updateWebSocket } from '../io/network';

export const gameLoop = () => {
  updateWebSocket();
  updateChat();
  render();
  requestAnimationFrame(gameLoop);
};
