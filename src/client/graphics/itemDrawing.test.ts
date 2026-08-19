import { describe, it, expect, vi } from 'vitest';
import { ITEM_SIZE, TILE_SIZE } from '../../shared/constants';
import { recordingContext } from '../../test/clientModule';
import { buildEntityAtlas } from './atlas';
import { getSpriteCoordinates } from './spriteCoordinates';
import { drawItemGeneric, renderItemIcon } from './itemDrawing';

const SHEET = ITEM_SIZE * 4; // four icons per row

describe('getSpriteCoordinates', () => {
  it('wraps to the next row at the end of the sheet', () => {
    expect(getSpriteCoordinates(0, SHEET)).toEqual({ x: 0, y: 0 });
    expect(getSpriteCoordinates(3, SHEET)).toEqual({ x: 3 * ITEM_SIZE, y: 0 });
    expect(getSpriteCoordinates(4, SHEET)).toEqual({ x: 0, y: ITEM_SIZE });
  });
});

// The atlas is module state that only ever gets built, so the "not loaded yet"
// case has to be asserted before any test builds it.
describe('before the atlas is built', () => {
  it('draws nothing rather than blitting from null', () => {
    const rec = recordingContext();
    renderItemIcon(rec.ctx, 1, 0, 0);
    drawItemGeneric(rec.ctx, 1, 0, 0, 32, 32);
    expect(rec.calls).toEqual([]);
  });
});

describe('with the atlas built', () => {
  const buildAtlas = () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      recordingContext().ctx,
    );
    const c = document.createElement('canvas');
    c.width = SHEET;
    c.height = ITEM_SIZE * 2;
    buildEntityAtlas({
      sprites: c,
      items: c,
      spells: c,
      arrows: c,
      attackEffect: c,
    });
  };

  it('centres a world icon in its tile by default', () => {
    buildAtlas();
    const rec = recordingContext();
    const pad = (TILE_SIZE - ITEM_SIZE) / 2;

    renderItemIcon(rec.ctx, 1, 640, 320);
    renderItemIcon(rec.ctx, 5, 640, 320);

    const [first, second] = rec.of('drawImage').map((c) => c.args as number[]);
    expect(first.slice(5, 7)).toEqual([640 + pad, 320 + pad]);
    // 5 is one row below 1 in a four-wide sheet, and the source y carries the
    // atlas offset of the items block, so only the step between them is fixed
    expect(second[1]).toBe(first[1]);
    expect(second[2] - first[2]).toBe(ITEM_SIZE);
  });

  it('draws flush when the caller places it itself, as a slot does', () => {
    buildAtlas();
    const rec = recordingContext();

    renderItemIcon(rec.ctx, 0, 640, 320, false);

    expect((rec.of('drawImage')[0].args as number[]).slice(5, 7)).toEqual([
      640, 320,
    ]);
  });

  it('scales to the destination box it is given', () => {
    buildAtlas();
    const rec = recordingContext();

    drawItemGeneric(rec.ctx, 0, 10, 20, 24, 24);

    expect((rec.of('drawImage')[0].args as number[]).slice(3)).toEqual([
      ITEM_SIZE,
      ITEM_SIZE,
      10,
      20,
      24,
      24,
    ]);
  });
});
