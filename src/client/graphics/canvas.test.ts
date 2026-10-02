import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { initGameCanvas, visibleView, worldScale, worldText } from './canvas';

const brand = vi.hoisted(() => ({ art: 'pixel' }));
vi.mock('../io/network/http/authClient', () => ({
  getGameBrand: () => brand,
  fetchGameBrand: () => Promise.resolve(brand),
}));

// The layer stack spans the contexts here, the <canvas> elements in
// GameCanvas.tsx and the z-index tokens in styles.css; this pins the order.
const css = fs.readFileSync(
  path.resolve(__dirname, '../../../public/styles.css'),
  'utf-8',
);

const layer = (name: string) => {
  const m = new RegExp(`--z-canvas-${name}:\\s*(\\d+)`).exec(css);
  if (!m) throw new Error(`no --z-canvas-${name} token in styles.css`);
  return Number(m[1]);
};

describe('canvas stacking order', () => {
  it('stacks ground, mask, items, actors and fringe in that order', () => {
    expect(layer('base')).toBeLessThan(layer('mask'));
    expect(layer('mask')).toBeLessThan(layer('items'));
    expect(layer('items')).toBeLessThan(layer('actors'));
    expect(layer('actors')).toBeLessThan(layer('fringe'));
  });

  it('keeps editor markers above the fringe they annotate', () => {
    expect(layer('grid')).toBeGreaterThan(layer('fringe'));
  });

  it('keeps every canvas below the HUD and the editor chrome', () => {
    const top = Math.max(
      ...['base', 'mask', 'items', 'actors', 'fringe', 'grid'].map(layer),
    );
    const token = (name: string) =>
      Number(new RegExp(`--z-${name}:\\s*(\\d+)`).exec(css)?.[1]);
    expect(top).toBeLessThan(token('hud'));
    expect(top).toBeLessThan(token('editor'));
  });
});

describe('world text', () => {
  it('is drawn larger where the world is shown smaller, twice at most', async () => {
    document.body.innerHTML = ['foreground', 'mask', 'player', 'item', 'fringe']
      .map((name) => `<canvas id="${name}Canvas" width="1280"></canvas>`)
      .join('');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
    } as never);
    const shown = vi.spyOn(Element.prototype, 'clientWidth', 'get');
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    };
    const draw = vi.fn();
    const drawAt = (width: number) => {
      shown.mockReturnValue(width);
      initGameCanvas();
      worldText(ctx as never, 10, 20, draw);
    };

    // A desktop shows the world near its own size and leaves the text alone.
    drawAt(1088);
    expect(ctx.scale).not.toHaveBeenCalled();

    // A phone on its side: grown about the point the label hangs from.
    drawAt(524);
    const [[k]] = ctx.scale.mock.calls as [[number]];
    expect(k).toBeCloseTo(1.78, 2);
    expect(ctx.translate.mock.calls).toEqual([
      [10, 20],
      [-10, -20],
    ]);

    // Upright the world is under a third of its size; the text stops at twice.
    drawAt(390);
    expect(ctx.scale).toHaveBeenLastCalledWith(2, 2);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    vi.restoreAllMocks();
  });
});

it('uses device pixels for smooth art while keeping the visible view logical', async () => {
  document.body.innerHTML = `<div id="canvasFrame">${[
    'foreground',
    'mask',
    'player',
    'item',
    'grid',
    'fringe',
  ]
    .map(
      (name) =>
        `<canvas id="${name}Canvas" width="1280" height="896"></canvas>`,
    )
    .join('')}</div>`;
  const ctx = { setTransform: vi.fn(), imageSmoothingEnabled: false };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as never,
  );
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1600);
  vi.stubGlobal('devicePixelRatio', 2);
  const rect = (x: number, y: number, width: number, height: number) =>
    ({
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height,
    }) as DOMRect;
  document.getElementById('playerCanvas')!.getBoundingClientRect = () =>
    rect(0, -110, 1600, 1120);
  document.getElementById('canvasFrame')!.getBoundingClientRect = () =>
    rect(0, 0, 1600, 900);
  brand.art = 'smooth';

  const stop = initGameCanvas();
  expect(worldScale).toBe(2);
  expect(document.querySelector('canvas')!.width).toBe(2560);
  expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  expect(ctx.imageSmoothingEnabled).toBe(true);
  expect(visibleView).toEqual({
    x: 0,
    y: 88,
    width: 1280,
    height: 720,
    scale: 1.25,
  });
  stop();
  brand.art = 'pixel';
  initGameCanvas()();
  expect(worldScale).toBe(1);
  expect(ctx.imageSmoothingEnabled).toBe(false);
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
