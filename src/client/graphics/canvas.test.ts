import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

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
