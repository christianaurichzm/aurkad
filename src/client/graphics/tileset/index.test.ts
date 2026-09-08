import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tile } from '../../../shared/types';
import { getEditorTiles, renderGameMap, setEditorTiles } from './index';

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

  it('leaves the editor copy alone', () => {
    // The editor loads its own copy over the admin route: the game's tiles
    // are `TilePublic`, stripped of every trigger, warp and door, and an
    // editor seeded from them would save a map with the rules erased.
    setEditorTiles(mapOf(9));
    const loaded = getEditorTiles();

    renderGameMap(mapOf(1));

    expect(getEditorTiles()).toBe(loaded);
    expect(getEditorTiles()[0]?.[0]?.tileIndex).toBe(9);
  });
});

describe('the map the editor holds', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
  });

  it('keeps what the admin route sent, rules and all', () => {
    setEditorTiles([
      [
        {
          tileIndex: 2,
          triggers: [{ action: 'script', scriptId: 'reward' }],
          warp: { to: 'cave', position: { x: 0, y: 0 } },
        },
      ],
    ]);

    const tile = getEditorTiles()[0]?.[0];
    expect(tile?.triggers?.[0]).toMatchObject({ scriptId: 'reward' });
    expect(tile?.warp?.to).toBe('cave');
  });

  it('takes a copy, so editing does not write through to the fetched map', () => {
    const fetched = mapOf(6);
    setEditorTiles(fetched);

    getEditorTiles()[0][0].tileIndex = 7;

    expect(fetched[0]?.[0]?.tileIndex).toBe(6);
  });
});
