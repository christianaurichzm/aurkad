import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadClientModule, recordingContext } from '../../../test/clientModule';

// The shipped modules/daynight/client.js, loaded the way the browser loads
// it. The test checks the tint it draws, whose colour and strength come from
// the wall clock.

const CYCLE_MS = 60 * 60 * 1000;

/** Puts the clock at a chosen phase of the cycle, 0 = midnight, 0.5 = noon. */
function atPhase(phase: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(phase * CYCLE_MS));
}

function drawAt(phase: number, cam = { x: 0, y: 0 }) {
  atPhase(phase);
  const mod = loadClientModule('daynight');
  const rec = recordingContext(800, 600);
  mod.overlays.forEach((o) => o.fn(rec.ctx, cam));
  return rec;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('daynight overlay', () => {
  it('draws on the scene layer, so the hud stays above it', () => {
    atPhase(0);
    const mod = loadClientModule('daynight');

    expect(mod.overlays).toHaveLength(1);
    expect(mod.overlays[0].order).toBe(50);
  });

  it('covers the whole screen, in screen space', () => {
    const rec = drawAt(0, { x: 640, y: 480 });

    // Undoes the camera before filling: the sky belongs to the view, not to a
    // rectangle of the world.
    expect(rec.of('translate')[0].args).toEqual([640, 480]);
    expect(rec.of('fillRect')[0].args).toEqual([0, 0, 800, 600]);
  });

  it('paints nothing at noon', () => {
    const rec = drawAt(0.5);

    expect(rec.of('fillRect')).toHaveLength(0);
  });

  it('paints its darkest at midnight', () => {
    const rec = drawAt(0);

    expect(rec.of('fillRect')).toHaveLength(1);
  });

  // Stepping between stops would look like a light switch, not dusk.
  it('fades between stops instead of stepping', () => {
    const alphaAt = (phase: number) => {
      const rec = drawAt(phase);
      const fill = rec.ctx.fillStyle;
      const style = typeof fill === 'string' ? fill : '';
      return Number(/,([\d.]+)\)$/.exec(style)?.[1] ?? 0);
    };

    const dusk = alphaAt(0.75);
    const later = alphaAt(0.8);
    const night = alphaAt(0.85);

    expect(dusk).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(dusk);
    expect(night).toBeGreaterThan(later);
  });

  // The phase comes from the wall clock, not uptime, so clients agree.
  it('gives the same tint to two clients at the same instant', () => {
    const first = drawAt(0.1).ctx.fillStyle;
    const second = drawAt(0.1).ctx.fillStyle;

    expect(first).toBe(second);
  });
});
