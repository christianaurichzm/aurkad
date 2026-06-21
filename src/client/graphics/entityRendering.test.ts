import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDroppedItems } from './entityRendering';
import { renderItemIcon } from './itemDrawing';

const mocks = vi.hoisted(() => ({
  itemCtx: {} as CanvasRenderingContext2D,
  renderItemIcon: vi.fn(),
}));

vi.mock('./canvas', () => ({
  itemCtx: mocks.itemCtx,
}));

vi.mock('./itemDrawing', () => ({
  renderItemIcon: mocks.renderItemIcon,
}));

vi.mock('./spriteDrawing', () => ({
  drawSprite: vi.fn(),
}));

vi.mock('./hud', () => ({
  renderHUD: vi.fn(),
  renderHealthBar: vi.fn(),
}));

vi.mock('./movementAnimation', () => ({
  getAnimatedState: vi.fn((_: string, position) => ({
    moving: false,
    position,
  })),
}));

describe('renderDroppedItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('draws each dropped item from map state', () => {
    renderDroppedItems([
      { itemId: 1, sprite: 7, position: { x: 64, y: 128 } },
      { itemId: 2, sprite: 8, position: { x: 192, y: 256 } },
    ]);

    expect(renderItemIcon).toHaveBeenCalledTimes(2);
    expect(renderItemIcon).toHaveBeenNthCalledWith(
      1,
      mocks.itemCtx,
      7,
      64,
      128,
    );
    expect(renderItemIcon).toHaveBeenNthCalledWith(
      2,
      mocks.itemCtx,
      8,
      192,
      256,
    );
  });
});
