import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDroppedItems, renderEntitiesSorted } from './entityRendering';
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
      { itemId: 1, sprite: 7, position: { x: 64, y: 128 }, quantity: 1 },
      { itemId: 2, sprite: 8, position: { x: 192, y: 256 }, quantity: 1 },
    ]);

    expect(renderItemIcon).toHaveBeenCalledTimes(2);
    expect(renderItemIcon).toHaveBeenNthCalledWith(
      1,
      mocks.itemCtx,
      7,
      64,
      128,
      false,
    );
    expect(renderItemIcon).toHaveBeenNthCalledWith(
      2,
      mocks.itemCtx,
      8,
      192,
      256,
      false,
    );
  });
});

describe('renderEntitiesSorted', () => {
  it('gives a health bar to every npc a player can fight, and to no other', () => {
    const npc = (id: string, behavior: string) =>
      ({
        id,
        behavior,
        health: 10,
        maxHealth: 10,
        position: { x: 0, y: 0 },
      }) as never;
    const bars = renderEntitiesSorted(
      {},
      {
        a: npc('a', 'aggressive'),
        h: npc('h', 'hostile'),
        f: npc('f', 'friendly'),
        s: npc('s', 'shopkeeper'),
      },
    ).map((e) => [e.entity.id, e.kind === 'npc' && e.hasHealthBar]);

    expect(Object.fromEntries(bars)).toEqual({
      a: true,
      h: true,
      f: false,
      s: false,
    });
  });
});

it('interleaves isometric props with actors by projected feet instead of logical y', async () => {
  const { setStaticMap } = await import('../core/gameState');
  const { drawSprite } = await import('./spriteDrawing');
  const order: string[] = [];
  vi.mocked(drawSprite).mockImplementation((index) => {
    order.push(`actor${index}`);
  });
  setStaticMap({
    id: 'iso',
    name: 'iso',
    type: 'normal',
    orientation: 'isometric',
    tiles: [],
  });
  renderEntitiesSorted(
    {
      front: { id: 'front', sprite: 1, position: { x: 192, y: 0 } },
      back: { id: 'back', sprite: 2, position: { x: 0, y: 64 } },
    } as never,
    {},
    [
      {
        y: 48,
        draw: () => {
          order.push('prop');
        },
      },
    ],
  );
  expect(order).toEqual(['actor2', 'prop', 'actor1']);
  setStaticMap({ id: 'ortho', name: 'ortho', type: 'normal', tiles: [] });
});
