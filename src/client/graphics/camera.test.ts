import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../shared/constants';
import type { Tile } from '../../shared/types';
import { calcCamera } from './camera';

// 40x20 tiles: 2560x1280 pixels, wider and taller than the 1280x896 viewport.
const tiles: Tile[][] = Array.from({ length: 20 }, () =>
  Array.from({ length: 40 }, () => ({ tileIndex: 0 })),
);

describe('calcCamera', () => {
  it('centres the player and lands on a whole pixel', () => {
    // The position it follows is interpolated, so it arrives fractional: what
    // comes out has to be whole, or every tile under it is resampled.
    const cam = calcCamera(1000.4, 700.6, tiles);

    expect(cam).toEqual({
      x: Math.round(1000.4 + TILE_SIZE / 2 - 640),
      y: Math.round(700.6 + TILE_SIZE / 2 - 448),
    });
    expect(Number.isInteger(cam.x) && Number.isInteger(cam.y)).toBe(true);
  });

  it('stops at the edges of the map', () => {
    expect(calcCamera(0, 0, tiles)).toEqual({ x: 0, y: 0 });
    expect(calcCamera(2500.7, 1200.2, tiles)).toEqual({
      x: 2560 - 1280,
      y: 1280 - 896,
    });
  });
});
