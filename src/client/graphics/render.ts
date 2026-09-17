export { getSpriteCoordinates } from './spriteCoordinates';
export { renderItemIcon, drawItemGeneric } from './itemDrawing';
export { drawSpriteGeneric, drawSprite } from './spriteDrawing';
export { onServerPositionUpdate } from './movementAnimation';
export { renderPlayers } from './entityRendering';

import { Tile } from '../../shared/types';
import { GAME_HEIGHT, GAME_WIDTH } from '../../shared/constants';
import { getGameState, getPlayer, isMapPending } from '../core/gameState';
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
  renderGameMap,
  renderEditorLayer,
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
import { renderSpellEffects } from './spellEffect';
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

// How long the cover takes to lift once the ground is there. Long enough to
// read as a transition, short enough that nobody waits for it.
const MAP_FADE_MS = 180;
let mapCover = 0;
let coverAt = 0;

/**
 * A black cover over the world while the map under the player arrives, so
 * a border crossing is not characters floating on the background. Drawn
 * last on the fringe, the top layer.
 */
function drawMapCover(): void {
  const now = performance.now();
  const elapsed = coverAt ? now - coverAt : 0;
  coverAt = now;

  if (isMapPending()) mapCover = 1;
  else if (mapCover > 0)
    mapCover = Math.max(0, mapCover - elapsed / MAP_FADE_MS);

  if (mapCover <= 0 || !fringeCtx) return;
  fringeCtx.save();
  fringeCtx.globalAlpha = mapCover;
  fringeCtx.fillStyle = '#000';
  fringeCtx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  fringeCtx.restore();
}

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

    playerCtx.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
    itemCtx.clearRect(0, 0, itemCanvas.width, itemCanvas.height);

    // The ground and the editor's overlay are drawn in camera space, so both
    // go stale when the camera moves. Unsaved edits live only in the editor's
    // copy of the map, which is the one drawn while it holds them, and holding
    // them keeps the pass dirty, as painting a tile changes no game state.
    const editorTiles = mapEdited ? getEditorTiles() : null;
    const tilesDirty =
      map.tiles !== lastDrawnTiles || cam.x !== lastCamX || cam.y !== lastCamY;
    if (tilesDirty) {
      foregroundCtx.clearRect(
        0,
        0,
        foregroundCanvas.width,
        foregroundCanvas.height,
      );
      renderGameMap(editorTiles ?? map.tiles);
      renderEditorLayer();
      lastDrawnTiles = editorTiles ? null : map.tiles;
      lastCamX = cam.x;
      lastCamY = cam.y;
    }

    // Mask and fringe caches, rerendered only when tiles or camera change.
    const overlayDirty =
      map.tiles !== lastFringeTiles ||
      cam.x !== lastFringeCamX ||
      cam.y !== lastFringeCamY;

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
      offMask.imageSmoothingEnabled = false;
      offMask.clearRect(0, 0, maskOffscreen.width, maskOffscreen.height);
      offMask.save();
      offMask.translate(-cam.x, -cam.y);
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
      offFringe.imageSmoothingEnabled = false;
      offFringe.clearRect(0, 0, fringeOffscreen.width, fringeOffscreen.height);
      offFringe.save();
      offFringe.translate(-cam.x, -cam.y);
      renderMapFringe(map.tiles, offFringe);
      offFringe.restore();

      lastFringeTiles = map.tiles;
      lastFringeCamX = cam.x;
      lastFringeCamY = cam.y;
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
    renderSpellEffects(playerCtx);
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

  // Outside the block, since frames with no map are the ones to cover.
  drawMapCover();
};
