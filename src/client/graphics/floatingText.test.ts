import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordingContext } from '../../test/clientModule';
import { renderFloatingTexts, spawnFloatingText } from './floatingText';

// The pool is module state, so time is driven rather than waited on and every
// test ends by rendering past the duration, which is what recycles a slot.
let now = 0;

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  now += 100_000;
  renderFloatingTexts(recordingContext().ctx); // expire whatever is left
  vi.restoreAllMocks();
});

describe('spawnFloatingText', () => {
  it('draws the text stroked and filled at the spawn point', () => {
    const rec = recordingContext();
    spawnFloatingText(100, 200, '-12', '#ff0000');

    renderFloatingTexts(rec.ctx);

    expect(rec.of('fillText')[0].args).toEqual(['-12', 100, 200]);
    expect(rec.of('strokeText')).toHaveLength(1); // the outline that keeps it readable
  });

  it('rises and fades over its life, then stops being drawn', () => {
    const rec = recordingContext();
    spawnFloatingText(0, 0, '+5', '#0f0', 1000);

    now += 500; // half way: risen, still opaque
    renderFloatingTexts(rec.ctx);
    const [, , midY] = rec.of('fillText')[0].args as [string, number, number];
    expect(midY).toBeLessThan(0);
    expect(rec.ctx.globalAlpha).toBe(1);

    now += 300; // 80%: past the 60% mark, so fading
    renderFloatingTexts(rec.ctx);
    expect(rec.ctx.globalAlpha).toBeGreaterThan(0);
    expect(rec.ctx.globalAlpha).toBeLessThan(1);

    now += 300; // past the duration
    renderFloatingTexts(rec.ctx);
    expect(rec.of('fillText')).toHaveLength(2); // no third draw
  });

  it('follows a live position when given one, so a number tracks its target', () => {
    const rec = recordingContext();
    let y = 300;
    spawnFloatingText(0, 0, '-3', '#fff', 1000, 16, () => ({ x: 50, y }));

    renderFloatingTexts(rec.ctx);
    y = 400;
    now += 1;
    renderFloatingTexts(rec.ctx);

    const xs = rec.of('fillText').map((c) => c.args[1]);
    const ys = rec.of('fillText').map((c) => c.args[2] as number);
    expect(xs).toEqual([50, 50]);
    expect(ys[1] - ys[0]).toBeCloseTo(100, 0);
  });

  it('drops the spawn instead of growing when the pool is full', () => {
    const rec = recordingContext();
    for (let i = 0; i < 70; i++) spawnFloatingText(0, 0, `t${i}`);

    renderFloatingTexts(rec.ctx);

    expect(rec.of('fillText')).toHaveLength(64); // the pool size, not 70
  });
});
