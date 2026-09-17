import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tile } from '../../shared/types';

const mocks = vi.hoisted(() => {
  const ctx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
  };
  return {
    ctx,
    // Its own spy: every other canvas is cleared on every frame, so a shared
    // one cannot say whether the ground was repainted.
    groundCtx: { ...ctx, clearRect: vi.fn() },
    cam: { x: 0, y: 0 },
    mapEdited: false,
    editorTiles: [] as Tile[][],
    state: null as ReturnType<typeof gameStateWith> | null,
    renderGameMap: vi.fn(),
    renderEditorLayer: vi.fn(),
  };
});

const canvas = { width: 128, height: 64 };
vi.mock('./canvas', () => ({
  foregroundCanvas: canvas,
  foregroundCtx: mocks.groundCtx,
  maskCanvas: canvas,
  maskCtx: mocks.ctx,
  itemCanvas: canvas,
  itemCtx: mocks.ctx,
  playerCtx: mocks.ctx,
  fringeCanvas: canvas,
  fringeCtx: mocks.ctx,
}));

vi.mock('./tileset', () => ({
  renderGameMap: mocks.renderGameMap,
  renderEditorLayer: mocks.renderEditorLayer,
  renderMapMask: vi.fn(),
  renderMapFringe: vi.fn(),
  getEditorTiles: () => mocks.editorTiles,
}));

vi.mock('../core/gameState', () => ({
  getGameState: () => mocks.state,
  getPlayer: () => ({ id: 'p1', position: { x: 0, y: 0 } }),
  isMapPending: () => false,
}));

vi.mock('./camera', () => ({
  calcCamera: () => mocks.cam,
  setCamera: vi.fn(),
}));

vi.mock('../stores/uiStore', () => ({
  useUIStore: { getState: () => ({ mapEdited: mocks.mapEdited }) },
}));

vi.mock('./entityRendering', () => ({
  renderEntitiesSorted: vi.fn(),
  renderDroppedItems: vi.fn(),
  renderPlayers: vi.fn(),
  animate: (player: unknown) => player,
}));

vi.mock('./hud', () => ({ updatePlayerHealthBar: vi.fn() }));
vi.mock('./floatingText', () => ({ renderFloatingTexts: vi.fn() }));
vi.mock('./projectiles', () => ({ renderProjectiles: vi.fn() }));
vi.mock('./attackEffect', () => ({ renderAttackEffects: vi.fn() }));
vi.mock('./spellEffect', () => ({ renderSpellEffects: vi.fn() }));
vi.mock('./overlayRegistry', () => ({ runOverlays: vi.fn() }));
vi.mock('./spriteCoordinates', () => ({ getSpriteCoordinates: vi.fn() }));
vi.mock('./itemDrawing', () => ({
  renderItemIcon: vi.fn(),
  drawItemGeneric: vi.fn(),
}));
vi.mock('./spriteDrawing', () => ({
  drawSpriteGeneric: vi.fn(),
  drawSprite: vi.fn(),
}));
vi.mock('./movementAnimation', () => ({ onServerPositionUpdate: vi.fn() }));

const gameStateWith = (tiles: Tile[][]) => ({
  id: 'aurora',
  tiles,
  players: {},
  npcs: {},
  droppedItems: [],
});

const mapOf = (tileIndex: number): Tile[][] =>
  Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ({ tileIndex })),
  );

// The pass caches what it last drew in module state, so each test gets its own
// copy of the module rather than the leftovers of the one before it.
const freshRender = async () => {
  vi.resetModules();
  return (await import('./render')).render;
};

describe('the ground pass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cam = { x: 0, y: 0 };
    mocks.mapEdited = false;
    mocks.editorTiles = [];
    mocks.state = gameStateWith(mapOf(1));
    // The mask and fringe caches are offscreen canvases, which jsdom has not.
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return mocks.ctx;
      }
    };
  });

  it('repaints the editor overlay wherever it repaints the ground', async () => {
    // Both draw in camera space on canvases the frame does not otherwise touch,
    // so they must repaint together.
    const render = await freshRender();

    render();
    expect(mocks.renderEditorLayer).toHaveBeenCalledTimes(1);

    mocks.cam = { x: 64, y: 0 };
    render();

    expect(mocks.renderGameMap).toHaveBeenCalledTimes(2);
    expect(mocks.renderEditorLayer).toHaveBeenCalledTimes(2);
  });

  it('keeps repainting from the editor copy while it holds unsaved edits', async () => {
    // An edit changes neither the game state nor the camera, so the pass stays
    // dirty on its own while the editor holds unsent tiles.
    const render = await freshRender();
    mocks.mapEdited = true;
    mocks.editorTiles = mapOf(9);

    render();
    render();

    expect(mocks.renderGameMap).toHaveBeenCalledTimes(2);
    expect(mocks.renderGameMap).toHaveBeenLastCalledWith(mocks.editorTiles);
  });

  it('draws nothing on a frame where neither the map nor the camera moved', async () => {
    // Whatever clears the ground outside this pass must put it back, since a
    // still frame will not.
    const render = await freshRender();

    render();
    vi.clearAllMocks();
    render();

    expect(mocks.renderGameMap).not.toHaveBeenCalled();
    expect(mocks.groundCtx.clearRect).not.toHaveBeenCalled();
  });
});
