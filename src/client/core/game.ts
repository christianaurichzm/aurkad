import { render } from '../graphics/render';
import { updateChat, updateWebSocket } from '../io/network';
import { getPlayer } from './gameState';
import { spawnFloatingText } from '../graphics/floatingText';
import { TILE_SIZE } from '../../shared/constants';

let prevLevel = 0;

export const gameLoop = () => {
  updateWebSocket();
  updateChat();

  const player = getPlayer();
  if (player) {
    if (prevLevel === 0) {
      prevLevel = player.level;
    } else if (player.level > prevLevel) {
      spawnFloatingText(
        player.position.x + TILE_SIZE / 2,
        player.position.y - 10,
        'LEVEL UP!',
        '#ffd700',
        2400,
        22,
      );
      prevLevel = player.level;
    }
  }

  render();
  requestAnimationFrame(gameLoop);
};
