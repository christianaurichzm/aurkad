import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tile } from '../../../shared/types';
import { getEditorTiles, renderGameMap, renderMap } from './index';

const mocks = vi.hoisted(() => {
  const calls: { fn: string; args: unknown[] }[] = [];
  const record =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
    };
  return {
    calls,
    canvas: { width: 128, height: 64 },
    ctx: {
      clearRect: record('clearRect'),
      drawImage: record('drawImage'),
    } as unknown as CanvasRenderingContext2D,
  };
});

vi.mock('../canvas', () => ({
  foregroundCanvas: mocks.canvas,
  foregroundCtx: mocks.ctx,
  maskCtx: mocks.ctx,
  fringeCtx: mocks.ctx,
}));

vi.mock('../../io/assets', () => ({
  tileset: { width: 256, height: 256 },
  tilesetAlpha: { width: 256, height: 256 },
}));

vi.mock('../camera', () => ({ getCamera: () => ({ x: 0, y: 0 }) }));

vi.mock('../../io/network', () => ({
  saveMap: vi.fn(),
  fetchNpcs: vi.fn(),
}));

/** A 4x4 map, of which the 128x64 canvas shows three columns and two rows. */
const mapOf = (tileIndex: number): Tile[][] =>
  Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ({ tileIndex })),
  );

const counts = () => ({
  clears: mocks.calls.filter((c) => c.fn === 'clearRect').length,
  draws: mocks.calls.filter((c) => c.fn === 'drawImage').length,
});

describe('the map the game draws', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
  });

  it('clears once and draws only what the viewport covers', () => {
    renderGameMap(mapOf(1));

    // Two tiles: the loop walks one past the canvas edge and the draw culls
    // it, so a 128x64 viewport is 2x1 tiles, after one full-canvas clear.
    expect(counts()).toEqual({ clears: 1, draws: 2 });
  });

  it('copies the map for the editor once, not once per frame', () => {
    const tiles = mapOf(2);

    renderGameMap(tiles);
    const first = getEditorTiles();
    renderGameMap(tiles);

    expect(getEditorTiles()).toBe(first);
  });

  it('copies again when the server sends a different map', () => {
    renderGameMap(mapOf(3));
    const first = getEditorTiles();
    renderGameMap(mapOf(4));

    expect(getEditorTiles()).not.toBe(first);
    expect(getEditorTiles()[0]?.[0]?.tileIndex).toBe(4);
  });

  it('re-seeds the working copy after the editor has held it', () => {
    const tiles = mapOf(5);
    renderGameMap(tiles);

    // What the editor drew is its own copy, and the game's next frame starts
    // from the server's tiles again, which is how closing the editor drops
    // what was never saved.
    renderMap(getEditorTiles());
    const edited = getEditorTiles();
    renderGameMap(tiles);

    expect(getEditorTiles()).not.toBe(edited);
  });
});
