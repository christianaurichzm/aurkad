export { getSpriteCoordinates } from './spriteCoordinates';
export { renderItemIcon, drawItemGeneric } from './itemDrawing';
export { drawSpriteGeneric, drawSprite } from './spriteDrawing';
export { onServerPositionUpdate } from './movementAnimation';
export { renderPlayers } from './entityRendering';

import { Tile } from '../../shared/types';
import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from '../../shared/constants';
import { getGameState, getPlayer, isMapPending } from '../core/gameState';
import {
  findInteractPrompt,
  renderInteractPrompt,
  updatePlayerHealthBar,
} from './hud';
import {
  maskCanvas,
  maskCtx,
  itemCtx,
  playerCtx,
  fringeCanvas,
  fringeCtx,
  textCtx,
  prepareWorldContext,
  worldCanvasGeneration,
} from './canvas';
import {
  renderGameMap,
  renderMapMask,
  renderMapFringe,
  isometricMapObjects,
  animationStep,
} from './mapRender';
import { renderEditorLayer, getEditorTiles } from './mapEditor';
import {
  renderEntitiesSorted,
  renderEntityHuds,
  renderDroppedItems,
  animate,
} from './entityRendering';
import { renderFloatingTexts } from './floatingText';
import { renderProjectiles } from './projectiles';
import { renderAttackEffects } from './attackEffect';
import { namedNpcs, renderClickMark } from '../io/pointer';
import { renderSpellEffects } from './spellEffect';
import { useUIStore } from '../stores/uiStore';
import { calcCamera, setCamera, worldToView } from './camera';
import { OverlayLayer, runOverlays } from './overlayRegistry';

let lastDrawnTiles: Tile[][] | null = null;
let lastEditorTiles: Tile[][] | null = null;
let lastOrientation: string | undefined;
let lastCamX = 0;
let lastCamY = 0;
let lastCanvasGeneration = -1;
let lastAnimationStep = 0;

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
  // Over the text layer too, so no name floats over the missing map.
  for (const ctx of [fringeCtx, textCtx]) {
    ctx.save();
    ctx.globalAlpha = mapCover;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.restore();
  }
}

export const render = () => {
  const map = getGameState();
  const rawPlayer = getPlayer();
  const mapEdited = useUIStore.getState().mapEdited;

  // Every frame, the ones with no map included, or their names would linger.
  textCtx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  // Interpolate position before computing the camera so the background doesn't
  // jump discretely while the player sprite slides smoothly between tiles.
  const currentPlayer = rawPlayer ? animate(rawPlayer) : null;

  if (map) {
    const cam = currentPlayer
      ? calcCamera(currentPlayer.position.x, currentPlayer.position.y)
      : { x: 0, y: 0 };
    setCamera(cam);

    playerCtx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    itemCtx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // The ground and the editor's overlay are drawn in camera space, so both go
    // stale when the camera moves; unsaved edits draw from the editor's copy.
    // Every source the pass reads is in the check, so swapping sources (a
    // border crossed with the editor open) also repaints.
    const editorTiles = getEditorTiles();
    const ground = mapEdited ? editorTiles : map.tiles;
    const canvasDirty = worldCanvasGeneration !== lastCanvasGeneration;
    const step = animationStep(map.tiles);
    const tilesDirty =
      canvasDirty ||
      step !== lastAnimationStep ||
      map.orientation !== lastOrientation ||
      ground !== lastDrawnTiles ||
      editorTiles !== lastEditorTiles ||
      cam.x !== lastCamX ||
      cam.y !== lastCamY;
    if (tilesDirty) {
      renderGameMap(ground, mapEdited);
      renderEditorLayer();
      // The editor mutates its grid in place, so null keeps the pass dirty
      // while it is the one drawn.
      lastDrawnTiles = mapEdited ? null : map.tiles;
      lastEditorTiles = editorTiles;
      lastCamX = cam.x;
      lastCamY = cam.y;
    }

    // Mask and fringe caches, rerendered only when tiles or camera change.
    const overlayDirty =
      canvasDirty ||
      step !== lastAnimationStep ||
      map.orientation !== lastOrientation ||
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
      prepareWorldContext(offMask);
      offMask.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
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
      prepareWorldContext(offFringe);
      offFringe.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      offFringe.save();
      offFringe.translate(-cam.x, -cam.y);
      renderMapFringe(map.tiles, offFringe);
      offFringe.restore();

      lastFringeTiles = map.tiles;
      lastFringeCamX = cam.x;
      lastFringeCamY = cam.y;
    }

    lastOrientation = map.orientation;
    lastAnimationStep = step;
    lastCanvasGeneration = worldCanvasGeneration;

    // Mask canvas (above ground, below entities).
    maskCtx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    if (maskOffscreen && !mapEdited) {
      maskCtx.drawImage(maskOffscreen, 0, 0, GAME_WIDTH, GAME_HEIGHT);
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
    renderClickMark(playerCtx);
    const hudEntries = renderEntitiesSorted(
      playersWithSelf,
      map.npcs,
      isometricMapObjects(ground, playerCtx, currentPlayer?.position),
    );
    renderProjectiles(playerCtx);
    renderAttackEffects(playerCtx);
    renderSpellEffects(playerCtx);
    runOverlays(playerCtx, cam, OverlayLayer.world);
    playerCtx.restore();

    if (currentPlayer) {
      updatePlayerHealthBar(currentPlayer);
    }

    // Fringe canvas (above entities).
    fringeCtx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    if (fringeOffscreen && !mapEdited) {
      fringeCtx.drawImage(fringeOffscreen, 0, 0, GAME_WIDTH, GAME_HEIGHT);
    } else if (mapEdited) {
      fringeCtx.save();
      fringeCtx.translate(-cam.x, -cam.y);
      renderMapFringe(getEditorTiles());
      fringeCtx.restore();
    }
    fringeCtx.save();
    fringeCtx.translate(-cam.x, -cam.y);
    runOverlays(fringeCtx, cam, OverlayLayer.scene);
    fringeCtx.restore();
    textCtx.save();
    textCtx.translate(-cam.x, -cam.y);
    renderEntityHuds(hudEntries, textCtx, namedNpcs());
    // Asked where the server has the player, drawn where they are seen, and not
    // while a modal holds the keys.
    const prompt =
      rawPlayer && !document.querySelector('[aria-modal="true"]')
        ? findInteractPrompt(rawPlayer, map)
        : null;
    if (prompt && currentPlayer) {
      // Under the player's cell, wherever the projection puts it.
      const { x, y } = currentPlayer.position;
      const center = worldToView(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
      const bottom = worldToView(x + TILE_SIZE, y + TILE_SIZE);
      renderInteractPrompt(textCtx, prompt, center.x, bottom.y + 2);
    }
    const ui = useUIStore.getState();
    if (ui.promptKey !== (prompt?.key ?? null))
      ui.setPromptKey(prompt?.key ?? null);
    renderFloatingTexts(textCtx);
    // Same world translate the world layer gets, so an overlay undoing it with
    // translate(cam.x, cam.y) lands in screen space either way.
    runOverlays(textCtx, cam, OverlayLayer.hud);
    textCtx.restore();
  }

  // Outside the block, since frames with no map are the ones to cover.
  drawMapCover();
};
