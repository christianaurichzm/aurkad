// Re-export all public functions for backward compatibility
export { getSpriteCoordinates } from './spriteCoordinates';
export { renderItemIcon, drawItemGeneric } from './itemDrawing';
export { drawSpriteGeneric, drawSprite } from './spriteDrawing';
export { onServerPositionUpdate } from './movementAnimation';
export { renderPlayers } from './entityRendering';

import { Tile } from '../../shared/types';
import { getGameState, getPlayer } from '../core/gameState';
import { renderHUD, updatePlayerHealthBar } from './hud';
import {
  foregroundCanvas,
  foregroundCtx,
  itemCanvas,
  itemCtx,
  playerCtx,
  fringeCanvas,
  fringeCtx,
} from './canvas';
import { renderMap, renderMapFringe } from './tileset';
import {
  renderPlayers,
  renderNpcs,
  renderDroppedItems,
  renderEntityDirect,
  animate,
} from './entityRendering';
import { renderFloatingTexts } from './floatingText';
import { renderProjectiles } from './projectiles';
import { useUIStore } from '../stores/uiStore';

let lastDrawnTiles: Tile[][] | null = null;

export const render = () => {
  const map = getGameState();
  const currentPlayer = getPlayer();
  const mapEdited = useUIStore.getState().mapEdited;

  if (map) {
    playerCtx.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
    fringeCtx.clearRect(0, 0, fringeCanvas.width, fringeCanvas.height);

    if (!mapEdited) {
      if (map.tiles !== lastDrawnTiles) {
        foregroundCtx.clearRect(
          0,
          0,
          foregroundCanvas.width,
          foregroundCanvas.height,
        );
        renderMap(map.tiles);
        lastDrawnTiles = map.tiles;
      }
    } else {
      lastDrawnTiles = null;
    }
    itemCtx.clearRect(0, 0, itemCanvas.width, itemCanvas.height);

    renderDroppedItems(map.droppedItems);

    renderPlayers(map.players);

    if (currentPlayer) {
      const player = animate(currentPlayer);

      renderEntityDirect(player);

      renderHUD(player);
      updatePlayerHealthBar(currentPlayer);
    }

    renderNpcs(map.npcs);
    renderProjectiles(playerCtx);

    renderMapFringe(map.tiles);
    renderFloatingTexts(fringeCtx);
  }
};
