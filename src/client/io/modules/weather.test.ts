import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadClientModule,
  recordingContext,
  type LoadedClientModule,
} from '../../../test/clientModule';

// The shipped modules/weather/client.js. It only draws, so the tests check
// the draw calls.

const CYCLE_MS = 30 * 60 * 1000;

/** 0 = start of the wheel (clear), 0.6 = raining, 0.9 = snowing. */
function atPhase(phase: number) {
  vi.setSystemTime(new Date(phase * CYCLE_MS));
}

let mod: LoadedClientModule;

function frame(cam = { x: 0, y: 0 }) {
  const rec = recordingContext(800, 600);
  mod.overlays[0].fn(rec.ctx, cam);
  return rec;
}

beforeEach(() => {
  vi.useFakeTimers();
  atPhase(0);
  mod = loadClientModule('weather');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('weather overlay', () => {
  it('draws on the world layer, under the hud', () => {
    expect(mod.overlays).toHaveLength(1);
    expect(mod.overlays[0].order).toBe(0);
  });

  it('draws nothing while the sky is clear', () => {
    atPhase(0.1);

    expect(frame().calls).toHaveLength(0);
  });

  it('falls to the wheel when no script has said otherwise', () => {
    atPhase(0.7); // raining

    expect(frame().of('stroke').length).toBeGreaterThan(0);
  });

  it('takes what a script pushes over the wheel', () => {
    atPhase(0.1); // the wheel says clear
    mod.handlers.get('weather')!({ kind: 'snow', intensity: 1 });

    // Snow is drawn as dots, so it fills rather than strokes.
    expect(frame().of('fillRect').length).toBeGreaterThan(0);
  });

  it('hands control back to the wheel when the payload is unreadable', () => {
    mod.handlers.get('weather')!({ kind: 'rain', intensity: 1 });
    mod.handlers.get('weather')!(null);
    atPhase(0.1); // clear

    expect(frame().calls).toHaveLength(0);
  });

  it('refuses a kind it does not know instead of drawing something else', () => {
    mod.handlers.get('weather')!({ kind: 'meteors', intensity: 1 });

    expect(frame().calls).toHaveLength(0);
  });

  it('scales the number of particles with intensity', () => {
    mod.handlers.get('weather')!({ kind: 'rain', intensity: 1 });
    const heavy = frame().of('stroke').length;

    mod.handlers.get('weather')!({ kind: 'rain', intensity: 0.2 });
    const light = frame().of('stroke').length;

    expect(light).toBeLessThan(heavy);
    expect(light).toBeGreaterThan(0);
  });

  it('clamps an intensity a script gets wrong', () => {
    mod.handlers.get('weather')!({ kind: 'rain', intensity: 99 });
    const absurd = frame().of('stroke').length;

    mod.handlers.get('weather')!({ kind: 'rain', intensity: 1 });
    const full = frame().of('stroke').length;

    expect(absurd).toBe(full);
  });

  // In world space, so rain falls past a scrolling window instead of being
  // painted onto it.
  it('places particles around the camera, not around the origin', () => {
    mod.handlers.get('weather')!({ kind: 'snow', intensity: 1 });

    const far = frame({ x: 5000, y: 4000 });
    const [x, y] = far.of('fillRect')[0].args as number[];

    expect(x).toBeGreaterThanOrEqual(5000);
    expect(y).toBeGreaterThanOrEqual(4000 - 20);
  });
});
