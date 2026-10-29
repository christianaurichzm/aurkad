import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterAction } from '../../shared/types';
import {
  renderDroppedItems,
  renderEntitiesSorted,
  renderEntityHuds,
  type EntityHudEntry,
} from './entityRendering';
import { renderHealthBar, renderNpcLabel } from './hud';
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
  renderNpcLabel: vi.fn(),
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

  it('centres a drop on its isometric cell, where the pick-up key reaches it', async () => {
    const { setStaticMap } = await import('../core/gameState');
    const { projectPoint } = await import('../../shared/mapGeometry');
    setStaticMap({
      id: 'iso',
      name: 'iso',
      type: 'normal',
      orientation: 'isometric',
      tiles: [],
    });
    renderDroppedItems([
      { itemId: 1, sprite: 7, position: { x: 960, y: 704 }, quantity: 1 },
    ]);
    setStaticMap({ id: 'ortho', name: 'ortho', type: 'normal', tiles: [] });

    const centre = projectPoint(960 + 32, 704 + 32, 'isometric');
    expect(renderItemIcon).toHaveBeenCalledWith(
      mocks.itemCtx,
      7,
      centre.x - 32,
      centre.y - 32,
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

it('plays the walk cycle of a figure that loops, even standing still', async () => {
  const { setSpriteLayout, parseSpriteLayout, DEFAULT_SPRITE_LAYOUT } =
    await import('./sprite');
  const { drawSprite } = await import('./spriteDrawing');
  setSpriteLayout(
    parseSpriteLayout({ characters: { 7: { x: 0, y: 0, loop: true } } }),
  );
  const columns: number[] = [];
  vi.mocked(drawSprite).mockImplementation((_, column) => {
    columns.push(column);
  });
  const boss = {
    id: 'b',
    sprite: 7,
    behavior: 'aggressive',
    health: 1,
    maxHealth: 1,
    width: 64,
    height: 64,
    action: CharacterAction.Idle,
    position: { x: 0, y: 0 },
  } as never;
  const now = vi.spyOn(performance, 'now');
  for (const t of [0, 180, 360, 540, 720]) {
    now.mockReturnValue(t);
    renderEntitiesSorted({}, { b: boss });
  }
  expect(columns).toEqual([0, 1, 2, 3, 0]);
  now.mockRestore();
  setSpriteLayout(DEFAULT_SPRITE_LAYOUT);
});

it("walks a block of three frames 0-1-2-1 (RPG Maker's layout)", async () => {
  const { setSpriteLayout, parseSpriteLayout, DEFAULT_SPRITE_LAYOUT } =
    await import('./sprite');
  const { drawSprite } = await import('./spriteDrawing');
  setSpriteLayout(
    parseSpriteLayout({
      width: 48,
      height: 48,
      columns: 3,
      idleColumn: 1,
      characters: { 7: { x: 0, y: 0, loop: true } },
    }),
  );
  const columns: number[] = [];
  vi.mocked(drawSprite).mockImplementation((_, column) => {
    columns.push(column);
  });
  const slime = {
    id: 's',
    sprite: 7,
    behavior: 'neutral',
    health: 1,
    maxHealth: 1,
    width: 64,
    height: 64,
    action: CharacterAction.Idle,
    position: { x: 0, y: 0 },
  } as never;
  const now = vi.spyOn(performance, 'now');
  for (const t of [0, 180, 360, 540, 720]) {
    now.mockReturnValue(t);
    renderEntitiesSorted({}, { s: slime });
  }
  expect(columns).toEqual([0, 1, 2, 1, 0]);
  now.mockRestore();
  setSpriteLayout(DEFAULT_SPRITE_LAYOUT);
});

it('names a monster only once the pointer has found it, and every other npc always', () => {
  const npc = (id: string, behavior: string): EntityHudEntry =>
    ({
      kind: 'npc',
      y: 0,
      entity: { id, behavior },
      hasHealthBar: behavior === 'aggressive',
    }) as EntityHudEntry;
  const ctx = {} as CanvasRenderingContext2D;
  renderEntityHuds(
    [
      npc('risen', 'aggressive'),
      npc('knight', 'aggressive'),
      npc('brand', 'friendly'),
    ],
    ctx,
    new Set(['knight']),
  );
  expect(vi.mocked(renderNpcLabel).mock.calls.map(([n]) => n.id)).toEqual([
    'knight',
    'brand',
  ]);
  expect(renderHealthBar).toHaveBeenCalledTimes(2);
});
