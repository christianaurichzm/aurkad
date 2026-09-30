import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { initGameCanvas, worldText } from './canvas';

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
  it('is drawn larger where the world is shown smaller, twice at most', () => {
    document.body.innerHTML = ['foreground', 'mask', 'player', 'item', 'fringe']
      .map((name) => `<canvas id="${name}Canvas" width="1280"></canvas>`)
      .join('');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as never,
    );
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
    vi.restoreAllMocks();
  });
});
