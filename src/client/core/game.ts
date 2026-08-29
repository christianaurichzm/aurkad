import { render } from '../graphics/render';
import { updateChat, updateWebSocket } from '../io/network';
import { getPlayer } from './gameState';
import { spawnFloatingText } from '../graphics/floatingText';
import { getAnimatedPos } from '../graphics/entityRendering';
import { TILE_SIZE } from '../../shared/constants';
import { flushInputBuffer } from '../io/keyboard';
import { pollGamepad } from '../io/gamepad';
import { frameProfileEnabled, recordFrame } from './frameProfile';

let prevLevel = 0;
let lastFrameAt = 0;

export const gameLoop = () => {
  const frameAt = frameProfileEnabled ? performance.now() : 0;
  try {
    updateWebSocket();
    updateChat();
  } catch (err) {
    console.error('[gameLoop] network update error:', err);
  }

  const player = getPlayer();
  if (player) {
    if (prevLevel === 0) {
      prevLevel = player.level;
    } else if (player.level > prevLevel) {
      const pid = player.id;
      spawnFloatingText(
        player.position.x + TILE_SIZE / 2,
        player.position.y - 10,
        'LEVEL UP!',
        '#ffd700',
        2400,
        22,
        () => {
          const pos = getAnimatedPos(pid);
          return pos ? { x: pos.x + TILE_SIZE / 2, y: pos.y - 10 } : null;
        },
      );
      prevLevel = player.level;
    }
  }

  flushInputBuffer();
  pollGamepad();

  const renderAt = frameProfileEnabled ? performance.now() : 0;
  try {
    render();
  } catch (err) {
    console.error('[gameLoop] render error:', err);
  }
  if (frameProfileEnabled) {
    const now = performance.now();
    // The first frame has no gap to measure against, only a render.
    if (lastFrameAt) recordFrame(frameAt - lastFrameAt, now - renderAt);
    lastFrameAt = frameAt;
  }
  requestAnimationFrame(gameLoop);
};
