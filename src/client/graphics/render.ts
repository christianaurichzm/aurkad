// Re-export all public functions for backward compatibility
export { getSpriteCoordinates } from './spriteCoordinates';
export { renderItemIcon, drawItemGeneric } from './itemDrawing';
export { drawSpriteGeneric, drawSprite } from './spriteDrawing';
export { onServerPositionUpdate } from './movementAnimation';
export { renderPlayers } from './entityRendering';

import { getGameState, getPlayer } from '../core/gameState';
import { renderHUD, updatePlayerHealthBar } from './hud';
import {
  foregroundCanvas,
  foregroundCtx,
  itemCanvas,
  itemCtx,
  playerCtx,
} from './canvas';
import { renderMap } from './tileset';
import { getAnimatedPosition } from './movementAnimation';
import { renderPlayers, renderNpcs, renderDroppedItems, renderEntityDirect } from './entityRendering';
import { useUIStore } from '../stores/uiStore';

export const render = () => {
  const map = getGameState();
  const currentPlayer = getPlayer();
  const mapEdited = useUIStore.getState().mapEdited;

  if (map) {
    playerCtx.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
    if (!mapEdited) {
      foregroundCtx.clearRect(
        0,
        0,
        foregroundCanvas.width,
        foregroundCanvas.height,
      );
      renderMap(map.tiles);
    }
    itemCtx.clearRect(0, 0, itemCanvas.width, itemCanvas.height);

    renderDroppedItems(map.droppedItems);

    renderPlayers(map.players);

    if (currentPlayer) {
      const smoothPosition = getAnimatedPosition(currentPlayer.id);

      const player = {
        ...currentPlayer,
        position: smoothPosition,
      };

      renderEntityDirect(player);

      renderHUD(player);
      updatePlayerHealthBar(currentPlayer);
    }

    renderNpcs(map.npcs);
  }
};

