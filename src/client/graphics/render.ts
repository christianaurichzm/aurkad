export { getSpriteCoordinates } from './spriteCoordinates';
export { renderItemIcon, drawItemGeneric } from './itemDrawing';
export { drawSpriteGeneric, drawSprite } from './spriteDrawing';
export { onServerPositionUpdate } from './movementAnimation';
export { renderPlayers } from './entityRendering';

import { Tile } from '../../shared/types';
import { getGameState, getPlayer } from '../core/gameState';
import { updatePlayerHealthBar } from './hud';
import {
  foregroundCanvas,
  foregroundCtx,
  maskCanvas,
  maskCtx,
  itemCanvas,
  itemCtx,
  playerCtx,
  fringeCanvas,
  fringeCtx,
} from './canvas';
import {
  renderMap,
  renderMapMask,
  renderMapFringe,
  getEditorTiles,
} from './tileset';
import {
  renderEntitiesSorted,
  renderDroppedItems,
  animate,
} from './entityRendering';
import { renderFloatingTexts } from './floatingText';
import { renderProjectiles } from './projectiles';
import { renderAttackEffects } from './attackEffect';
import { useUIStore } from '../stores/uiStore';
import { calcCamera, setCamera } from './camera';
import { runOverlays } from './overlayRegistry';

let lastDrawnTiles: Tile[][] | null = null;
let lastCamX = 0;
let lastCamY = 0;

let maskOffscreen: OffscreenCanvas | null = null;
let fringeOffscreen: OffscreenCanvas | null = null;
let lastFringeTiles: Tile[][] | null = null;
let lastFringeCamX = -1;
let lastFringeCamY = -1;

export const render = () => {
  const map = getGameState();
  const rawPlayer = getPlayer();
  const mapEdited = useUIStore.getState().mapEdited;

  // Interpolate position before computing the camera so the background doesn't
  // jump discretely while the player sprite slides smoothly between tiles.
  const currentPlayer = rawPlayer ? animate(rawPlayer) : null;

  if (map) {
    const cam = currentPlayer
      ? calcCamera(currentPlayer.position.x, currentPlayer.position.y)
      : { x: 0, y: 0 };
    setCamera(cam);

    // Whole pixels for the dirty check, valid across sub-pixel moves.
    const camXi = Math.round(cam.x);
    const camYi = Math.round(cam.y);

    playerCtx.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
    itemCtx.clearRect(0, 0, itemCanvas.width, itemCanvas.height);

    if (!mapEdited) {
      const tilesDirty =
        map.tiles !== lastDrawnTiles ||
        camXi !== lastCamX ||
        camYi !== lastCamY;
      if (tilesDirty) {
        foregroundCtx.clearRect(
          0,
          0,
          foregroundCanvas.width,
          foregroundCanvas.height,
        );
        renderMap(map.tiles);
        lastDrawnTiles = map.tiles;
        lastCamX = camXi;
        lastCamY = camYi;
      }
    } else {
      lastDrawnTiles = null;
    }

    // Mask and fringe caches, rerendered only when tiles or camera change.
    const overlayDirty =
      map.tiles !== lastFringeTiles ||
      camXi !== lastFringeCamX ||
      camYi !== lastFringeCamY;

    if (overlayDirty && !mapEdited) {
      if (
        !maskOffscreen ||
        maskOffscreen.width !== maskCanvas.width ||
        maskOffscreen.height !== maskCanvas.height
      ) {
        maskOffscreen = new OffscreenCanvas(
          maskCanvas.width,
          maskCanvas.height,
        );
      }
      const offMask = maskOffscreen.getContext(
        '2d',
      ) as OffscreenCanvasRenderingContext2D;
      offMask.clearRect(0, 0, maskOffscreen.width, maskOffscreen.height);
      offMask.save();
      offMask.translate(-camXi, -camYi);
      renderMapMask(map.tiles, offMask);
      offMask.restore();

      if (
        !fringeOffscreen ||
        fringeOffscreen.width !== fringeCanvas.width ||
        fringeOffscreen.height !== fringeCanvas.height
      ) {
        fringeOffscreen = new OffscreenCanvas(
          fringeCanvas.width,
          fringeCanvas.height,
        );
      }
      const offFringe = fringeOffscreen.getContext(
        '2d',
      ) as OffscreenCanvasRenderingContext2D;
      offFringe.clearRect(0, 0, fringeOffscreen.width, fringeOffscreen.height);
      offFringe.save();
      offFringe.translate(-camXi, -camYi);
      renderMapFringe(map.tiles, offFringe);
      offFringe.restore();

      lastFringeTiles = map.tiles;
      lastFringeCamX = camXi;
      lastFringeCamY = camYi;
    }

    // Mask canvas (above ground, below entities).
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    if (maskOffscreen && !mapEdited) {
      maskCtx.drawImage(maskOffscreen, 0, 0);
    } else if (mapEdited) {
      maskCtx.save();
      maskCtx.translate(-cam.x, -cam.y);
      renderMapMask(getEditorTiles());
      maskCtx.restore();
    }

    itemCtx.save();
    itemCtx.translate(-cam.x, -cam.y);
    renderDroppedItems(map.droppedItems);
    itemCtx.restore();

    playerCtx.save();
    playerCtx.translate(-cam.x, -cam.y);
    const playersWithSelf = currentPlayer
      ? { ...map.players, [currentPlayer.id]: currentPlayer }
      : map.players;
    renderEntitiesSorted(playersWithSelf, map.npcs);
    renderProjectiles(playerCtx);
    renderAttackEffects(playerCtx);
    runOverlays(playerCtx, cam);
    playerCtx.restore();

    if (currentPlayer) {
      updatePlayerHealthBar(currentPlayer);
    }

    // Fringe canvas (above entities).
    fringeCtx.clearRect(0, 0, fringeCanvas.width, fringeCanvas.height);
    if (fringeOffscreen && !mapEdited) {
      fringeCtx.drawImage(fringeOffscreen, 0, 0);
    } else if (mapEdited) {
      fringeCtx.save();
      fringeCtx.translate(-cam.x, -cam.y);
      renderMapFringe(getEditorTiles());
      fringeCtx.restore();
    }
    fringeCtx.save();
    fringeCtx.translate(-cam.x, -cam.y);
    renderFloatingTexts(fringeCtx);
    fringeCtx.restore();
  }
};
