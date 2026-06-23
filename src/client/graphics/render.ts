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
import { calcCamera, setCamera } from './camera';

let lastDrawnTiles: Tile[][] | null = null;
let lastCamX = 0;
let lastCamY = 0;

export const render = () => {
  const map = getGameState();
  const currentPlayer = getPlayer();
  const mapEdited = useUIStore.getState().mapEdited;

  if (map) {
    const cam = currentPlayer
      ? calcCamera(
          currentPlayer.position.x,
          currentPlayer.position.y,
          map.tiles,
        )
      : { x: 0, y: 0 };
    setCamera(cam);

    playerCtx.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
    fringeCtx.clearRect(0, 0, fringeCanvas.width, fringeCanvas.height);
    itemCtx.clearRect(0, 0, itemCanvas.width, itemCanvas.height);

    if (!mapEdited) {
      const tilesDirty =
        map.tiles !== lastDrawnTiles ||
        cam.x !== lastCamX ||
        cam.y !== lastCamY;
      if (tilesDirty) {
        foregroundCtx.clearRect(
          0,
          0,
          foregroundCanvas.width,
          foregroundCanvas.height,
        );
        renderMap(map.tiles);
        lastDrawnTiles = map.tiles;
        lastCamX = cam.x;
        lastCamY = cam.y;
      }
    } else {
      lastDrawnTiles = null;
    }

    itemCtx.save();
    itemCtx.translate(-cam.x, -cam.y);
    renderDroppedItems(map.droppedItems);
    itemCtx.restore();

    playerCtx.save();
    playerCtx.translate(-cam.x, -cam.y);
    renderPlayers(map.players);
    if (currentPlayer) {
      const player = animate(currentPlayer);
      renderEntityDirect(player);
      renderHUD(player);
    }
    renderNpcs(map.npcs);
    renderProjectiles(playerCtx);
    playerCtx.restore();

    if (currentPlayer) {
      updatePlayerHealthBar(currentPlayer);
    }

    fringeCtx.save();
    fringeCtx.translate(-cam.x, -cam.y);
    renderMapFringe(map.tiles);
    renderFloatingTexts(fringeCtx);
    fringeCtx.restore();
  }
};
