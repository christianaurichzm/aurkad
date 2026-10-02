import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SPRITE_HEIGHT, SPRITE_WIDTH, TILE_SIZE } from '../../shared/constants';
import { recordingContext } from '../../test/clientModule';
import { buildEntityAtlas } from './atlas';
import {
  DEFAULT_SPRITE_LAYOUT,
  getCharacterSpriteCoordinates,
  parseSpriteLayout,
  setSpriteLayout,
} from './sprite';
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
  it('fills the tile with a frame of the default size', () => {
    buildAtlas();
    const rec = recordingContext();
    mocks.playerCtx.drawImage = rec.ctx.drawImage;

    drawSprite(0, 0, 0, 640, 320);

    const args = rec.of('drawImage')[0].args as number[];
    expect(args.slice(5)).toEqual([640, 320, SPRITE_WIDTH, SPRITE_HEIGHT]);
  });

  it('hangs a larger frame from its anchor at the foot of the tile', () => {
    buildAtlas();
    setSpriteLayout(parseSpriteLayout({ width: 96, height: 96, anchorY: 84 }));
    const rec = recordingContext();
    mocks.playerCtx.drawImage = rec.ctx.drawImage;

    drawSprite(0, 0, 0, 640, 320);

    const args = rec.of('drawImage')[0].args as number[];
    expect(args.slice(3)).toEqual([
      96,
      96,
      640 + TILE_SIZE / 2 - 48,
      320 + TILE_SIZE - 84,
      96,
      96,
    ]);
    setSpriteLayout(DEFAULT_SPRITE_LAYOUT);
  });

  it('draws a double-resolution frame in one logical tile', () => {
    buildAtlas();
    setSpriteLayout(parseSpriteLayout({ width: 128, height: 128, scale: 0.5 }));
    const rec = recordingContext();
    mocks.playerCtx.drawImage = rec.ctx.drawImage;
    drawSprite(0, 0, 0, 640, 320);
    expect(rec.of('drawImage')[0].args.slice(3)).toEqual([
      128, 128, 640, 320, 64, 64,
    ]);
    setSpriteLayout(DEFAULT_SPRITE_LAYOUT);
  });
});

describe('parseSpriteLayout', () => {
  it('is the 64 px grid when the game has no sprites.json', () => {
    expect(parseSpriteLayout({})).toEqual(DEFAULT_SPRITE_LAYOUT);
  });

  it('anchors a frame of another size at its bottom centre unless told', () => {
    expect(parseSpriteLayout({ width: 96, height: 80 })).toMatchObject({
      anchorX: 48,
      anchorY: 80,
      columns: 4,
    });
  });

  it('rejects an action frame outside the block', () => {
    expect(() => parseSpriteLayout({ columns: 6, attackColumn: 6 })).toThrow();
    expect(() => parseSpriteLayout({ idleColumn: 4 })).toThrow();
    expect(() => parseSpriteLayout({ scale: 0 })).toThrow();
  });

  it('lays blocks out by the frames a character has', () => {
    setSpriteLayout(parseSpriteLayout({ width: 96, height: 96, columns: 6 }));
    // two blocks of 6 x 96 fit a 1200 px sheet: character 2 opens row two
    expect(getCharacterSpriteCoordinates(2, 5, 3, 1200)).toEqual({
      x: 5 * 96,
      y: 4 * 96 + 3 * 96,
    });
    setSpriteLayout(DEFAULT_SPRITE_LAYOUT);
  });
});
