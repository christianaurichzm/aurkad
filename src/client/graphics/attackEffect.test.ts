import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TILE_SIZE } from '../../shared/constants';
import { Direction } from '../../shared/types';
import { recordingContext } from '../../test/clientModule';
import { buildEntityAtlas } from './atlas';
import { renderAttackEffects, spawnAttackEffect } from './attackEffect';

const mocks = vi.hoisted(() => ({ sheet: null as object | null }));
vi.mock('../io/assets', () => ({
  get attackEffectSheet() {
    return mocks.sheet;
  },
}));

let now = 0;

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  mocks.sheet = {};
});

afterEach(() => {
  now += 100_000;
  renderAttackEffects(recordingContext().ctx); // drain what is still playing
  vi.restoreAllMocks();
});

function buildAtlas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    recordingContext().ctx,
  );
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 64;
  buildEntityAtlas({
    sprites: c,
    items: c,
    spells: c,
    arrows: c,
    attackEffect: c,
  });
}

describe('spawnAttackEffect', () => {
  it('does not queue an effect while its sheet is missing', () => {
    mocks.sheet = null;
    const rec = recordingContext();

    spawnAttackEffect(0, 0, Direction.Up);
    renderAttackEffects(rec.ctx);

    expect(rec.calls).toEqual([]);
  });

  it('lands one tile away, on the side the swing faced', () => {
    buildAtlas();
    const rec = recordingContext();

    spawnAttackEffect(100, 100, Direction.Up);
    spawnAttackEffect(100, 100, Direction.Down);
    spawnAttackEffect(100, 100, Direction.Left);
    spawnAttackEffect(100, 100, Direction.Right);
    renderAttackEffects(rec.ctx);

    const at = rec.of('drawImage').map((c) => (c.args as number[]).slice(5, 7));
    // drawn newest first: the loop walks the list backwards so it can splice
    expect(at).toEqual([
      [100 + TILE_SIZE, 100],
      [100 - TILE_SIZE, 100],
      [100, 100 + TILE_SIZE],
      [100, 100 - TILE_SIZE],
    ]);
  });
});

describe('renderAttackEffects', () => {
  it('advances a frame per interval, then drops the effect', () => {
    buildAtlas();
    const rec = recordingContext();
    spawnAttackEffect(0, 0, Direction.Down);

    renderAttackEffects(rec.ctx);
    now += 140; // two frames in
    renderAttackEffects(rec.ctx);

    const sx = rec.of('drawImage').map((c) => (c.args as number[])[1]);
    expect(sx).toEqual([0, 128]);

    now += 300; // past the six frames
    renderAttackEffects(rec.ctx);
    expect(rec.of('drawImage')).toHaveLength(2);
  });
});
