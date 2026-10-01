import { describe, expect, it } from 'vitest';
import {
  calcViewport,
  mapCamera,
  projectPoint,
  unprojectPoint,
} from './mapGeometry.js';
import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from './constants.js';
import type { Tile } from './types.js';

describe('map projection', () => {
  it('round-trips every cell center, including negative and fractional positions', () => {
    for (const orientation of ['orthogonal', 'isometric'] as const) {
      for (const [x, y] of [
        [0, 0],
        [64, 0],
        [0, 64],
        [-100.25, 47.5],
        [1024, 2048],
      ]) {
        const p = projectPoint(x!, y!, orientation);
        expect(unprojectPoint(p.x, p.y, orientation)).toEqual({ x, y });
      }
    }
    // One cell is a diamond TILE_SIZE wide and half as tall.
    expect(projectPoint(64, 0, 'isometric')).toEqual({ x: 32, y: 16 });
    expect(projectPoint(0, 64, 'isometric')).toEqual({ x: -32, y: 16 });
    expect(projectPoint(64, 64, 'isometric')).toEqual({ x: 0, y: 32 });
  });

  it('streams every tile visible through the isometric camera, including tall props', () => {
    const tiles: Tile[][] = Array.from({ length: 48 }, () =>
      Array.from({ length: 80 }, () => ({ tileIndex: 0 })),
    );
    for (const [x, y] of [
      [0, 0],
      [1900, 1700],
      [79 * 64, 47 * 64],
    ]) {
      const camera = mapCamera(
        x!,
        y!,
        80 * TILE_SIZE,
        48 * TILE_SIZE,
        'isometric',
      );
      const bounds = calcViewport(x!, y!, tiles, 0, 'isometric');
      for (const [sx, sy] of [
        [0, 0],
        [GAME_WIDTH, 0],
        [0, GAME_HEIGHT + 512],
        [GAME_WIDTH, GAME_HEIGHT + 512],
      ]) {
        const p = unprojectPoint(camera.x + sx!, camera.y + sy!, 'isometric');
        expect(p.x).toBeGreaterThanOrEqual(bounds.left);
        expect(p.x).toBeLessThanOrEqual(bounds.right);
        expect(p.y).toBeGreaterThanOrEqual(bounds.top);
        expect(p.y).toBeLessThanOrEqual(bounds.bottom);
      }
    }
  });
});
