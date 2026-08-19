import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordingContext } from '../../test/clientModule';
import { dispatchServerEvent } from '../io/network/customEvents';
import { renderProjectiles } from './projectiles';
import { buildEntityAtlas } from './atlas';

vi.mock('../io/network/wsManager', () => ({ sendAction: vi.fn() }));

// Fired through the real dispatcher rather than a captured handler, so the
// channel name is part of what the test pins.
const fire = (payload: unknown) =>
  dispatchServerEvent('projectile:fire', payload);

let now = 0;

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  now += 100_000;
  renderProjectiles(recordingContext().ctx); // expire whatever is in flight
  vi.restoreAllMocks();
});

describe('projectile:fire', () => {
  it('ignores a payload without both endpoints', () => {
    const rec = recordingContext();
    fire({ fromX: 0, fromY: 0, toX: 100 }); // no toY
    fire(null);

    renderProjectiles(rec.ctx);

    expect(rec.calls).toEqual([]);
  });

  it('flies from one end to the other and lands', () => {
    const rec = recordingContext();
    fire({ fromX: 0, fromY: 0, toX: 400, toY: 200, duration: 200 });

    now += 50; // a quarter of the way
    renderProjectiles(rec.ctx);
    now += 100; // three quarters
    renderProjectiles(rec.ctx);

    expect(rec.of('translate').map((c) => c.args)).toEqual([
      [100, 50],
      [300, 150],
    ]);

    now += 100; // arrived
    renderProjectiles(rec.ctx);
    expect(rec.of('translate')).toHaveLength(2);
  });

  it('draws a plain arrow while the atlas is still loading', () => {
    const rec = recordingContext();
    fire({ fromX: 0, fromY: 0, toX: 10, toY: 0 });

    renderProjectiles(rec.ctx);

    expect(rec.of('drawImage')).toHaveLength(0);
    expect(rec.of('stroke')).toHaveLength(1);
  });

  it('picks the sprite row for the direction once the atlas is built', () => {
    // jsdom has no 2d context, and the atlas only needs somewhere to blit into
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      recordingContext().ctx,
    );
    const tile = document.createElement('canvas');
    tile.width = 128; // 4 tiles of 32 per row
    tile.height = 32;
    buildEntityAtlas({
      sprites: tile,
      items: tile,
      spells: tile,
      arrows: tile,
      attackEffect: tile,
    });

    const rec = recordingContext();
    // direction 1 is LEFT, offset 3 in the sheet's down/up/right/left row
    fire({ fromX: 0, fromY: 0, toX: 10, toY: 0, sprite: 0, direction: 1 });

    renderProjectiles(rec.ctx);

    const [, sx] = rec.of('drawImage')[0].args as [unknown, number];
    expect(sx).toBe(3 * 32);
  });
});
