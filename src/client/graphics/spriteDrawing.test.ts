import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SPRITE_HEIGHT, SPRITE_WIDTH, TILE_SIZE } from '../../shared/constants';
import { recordingContext } from '../../test/clientModule';
import { buildEntityAtlas } from './atlas';
import { getCharacterSpriteCoordinates, getSpriteSize } from './sprite';
import { drawSprite, drawSpriteGeneric } from './spriteDrawing';

const mocks = vi.hoisted(() => ({ playerCtx: {} as CanvasRenderingContext2D }));
vi.mock('./canvas', () => ({ playerCtx: mocks.playerCtx }));

const SHEET = SPRITE_WIDTH * 4 * 3; // three characters across

function buildAtlas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    recordingContext().ctx,
  );
  const sheet = document.createElement('canvas');
  sheet.width = SHEET;
  sheet.height = SPRITE_HEIGHT * 4;
  buildEntityAtlas({
    sprites: sheet,
    items: sheet,
    spells: sheet,
    arrows: sheet,
    attackEffect: sheet,
  });
}

describe('getCharacterSpriteCoordinates', () => {
  it('finds the frame inside the character block, not the sheet origin', () => {
    // character 4 with three per row: second row, second column of blocks
    expect(getCharacterSpriteCoordinates(4, 2, 1, SHEET)).toEqual({
      x: SPRITE_WIDTH * 4 + 2 * SPRITE_WIDTH,
      y: SPRITE_HEIGHT * 4 + SPRITE_HEIGHT,
    });
  });

  it('walks along the row for the characters that fit in it', () => {
    const first = getCharacterSpriteCoordinates(0, 0, 0, SHEET);
    const second = getCharacterSpriteCoordinates(1, 0, 0, SHEET);
    expect(second.x - first.x).toBe(SPRITE_WIDTH * 4);
    expect(second.y).toBe(first.y);
  });
});

describe('drawSpriteGeneric', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('draws nothing while the atlas is still loading', () => {
    const rec = recordingContext();
    drawSpriteGeneric(rec.ctx, 0, 0, 0, 10, 20, 32, 32);
    expect(rec.calls).toEqual([]);
  });

  it('blits the frame at the size it was asked for', () => {
    buildAtlas();
    const rec = recordingContext();

    drawSpriteGeneric(rec.ctx, 0, 1, 0, 10, 20, 128, 128);

    const args = rec.of('drawImage')[0].args;
    expect(args.slice(3)).toEqual([
      SPRITE_WIDTH,
      SPRITE_HEIGHT,
      10,
      20,
      128,
      128,
    ]);
    expect(args[1]).toBe(SPRITE_WIDTH); // column 1 of the first character
  });
});

describe('drawSprite', () => {
  it('centres the sprite in its tile', () => {
    buildAtlas();
    const rec = recordingContext();
    mocks.playerCtx.drawImage = rec.ctx.drawImage;
    const { SPRITE_WIDTH: w, SPRITE_HEIGHT: h } = getSpriteSize();

    drawSprite(0, 0, 0, 640, 320);

    const args = rec.of('drawImage')[0].args as number[];
    expect(args[5]).toBe(640 + (TILE_SIZE - w) / 2);
    expect(args[6]).toBe(320 + (TILE_SIZE - h) / 2);
  });
});
