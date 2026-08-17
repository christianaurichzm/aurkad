import { describe, it, expect, beforeEach, vi } from 'vitest';

// Settings are read from storage at module load, so each case re-imports
// with a fresh registry.
const importAudio = async () => {
  vi.resetModules();
  return import('./audio');
};

const fakeAudio = () => {
  const created: { volume: number; fail: () => void }[] = [];
  class FakeAudio {
    volume = 0;
    loop = false;
    src = '';
    private onError: (() => void) | null = null;
    constructor() {
      created.push(this);
    }
    addEventListener(type: string, handler: () => void) {
      if (type === 'error') this.onError = handler;
    }
    /** What the element does when the request 404s. */
    fail() {
      this.onError?.();
    }
    play() {
      return Promise.resolve();
    }
    pause() {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  return created;
};

describe('audio settings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('starts from the defaults with nothing stored', async () => {
    const { getAudioSettings } = await importAudio();
    expect(getAudioSettings()).toEqual({
      music: 0.4,
      effects: 0.6,
      muted: false,
    });
  });

  it('persists a change across a reload', async () => {
    const first = await importAudio();
    first.setAudioSettings({ music: 0.1, muted: true });

    const second = await importAudio();
    expect(second.getAudioSettings()).toMatchObject({
      music: 0.1,
      muted: true,
    });
  });

  // Out-of-range volume makes HTMLMediaElement throw IndexSizeError, and the
  // stored JSON is user-editable.
  it('clamps and falls back on stored garbage', async () => {
    localStorage.setItem(
      'audio',
      JSON.stringify({ music: 5, effects: 'loud', muted: 'yes' }),
    );
    const { getAudioSettings } = await importAudio();
    expect(getAudioSettings()).toEqual({
      music: 1,
      effects: 0.6,
      muted: false,
    });
  });

  it('survives unparseable storage', async () => {
    localStorage.setItem('audio', '{not json');
    const { getAudioSettings } = await importAudio();
    expect(getAudioSettings().music).toBe(0.4);
  });

  it('plays effects at the configured level, and none when muted', async () => {
    const created = fakeAudio();
    const { setAudioSettings, playSound } = await importAudio();

    setAudioSettings({ effects: 0.25 });
    playSound('attack.mp3');
    expect(created).toHaveLength(1);
    expect(created[0].volume).toBe(0.25);

    setAudioSettings({ muted: true });
    playSound('attack.mp3');
    expect(created).toHaveLength(1);
  });

  it('mutes playing music without stopping it', async () => {
    const created = fakeAudio();
    const { setAudioSettings, playMusic } = await importAudio();

    playMusic('town.mp3');
    expect(created[0].volume).toBe(0.4);

    setAudioSettings({ muted: true });
    expect(created[0].volume).toBe(0);

    setAudioSettings({ muted: false });
    expect(created[0].volume).toBe(0.4);
    expect(created).toHaveLength(1);
  });
});

// Twelve 64px tiles, read from the module under test so the expectations
// follow the range.
describe('placed sounds', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('is quieter with distance and silent past the range', async () => {
    const { spatialMix } = await importAudio();
    const ear = { x: 0, y: 0 };

    expect(spatialMix({ x: 0, y: 0 }, ear, 1)?.volume).toBe(1);
    expect(spatialMix({ x: 384, y: 0 }, ear, 1)?.volume).toBeCloseTo(0.5);
    expect(spatialMix({ x: 768, y: 0 }, ear, 1)).toBeNull();
    // Diagonal counts as distance, not as the larger axis.
    expect(spatialMix({ x: 600, y: 600 }, ear, 1)).toBeNull();
  });

  it('places the sound on the side it came from', async () => {
    const { spatialMix } = await importAudio();
    const ear = { x: 500, y: 500 };

    expect(spatialMix({ x: 884, y: 500 }, ear, 1)?.pan).toBeCloseTo(0.5);
    expect(spatialMix({ x: 116, y: 500 }, ear, 1)?.pan).toBeCloseTo(-0.5);
    expect(spatialMix({ x: 500, y: 600 }, ear, 1)?.pan).toBe(0);
  });

  it('scales the effects volume rather than replacing it', async () => {
    const { spatialMix } = await importAudio();

    expect(
      spatialMix({ x: 384, y: 0 }, { x: 0, y: 0 }, 0.5)?.volume,
    ).toBeCloseTo(0.25);
  });

  it('plays a placed sound at the mixed volume, and skips one out of earshot', async () => {
    const created = fakeAudio();
    const { playSound, setAudioListener } = await importAudio();

    setAudioListener({ x: 0, y: 0 });

    playSound('arrow.mp3', { x: 384, y: 0 });
    expect(created).toHaveLength(1);
    expect(created[0].volume).toBeCloseTo(0.3); // 0.6 effects, half range

    playSound('arrow.mp3', { x: 5000, y: 0 });
    expect(created).toHaveLength(1);
  });

  // Losing the sound would be the louder mistake, so it plays centred.
  it('plays a placed sound flat while there is no listener yet', async () => {
    const created = fakeAudio();
    const { playSound, setAudioListener } = await importAudio();

    setAudioListener(null);
    playSound('arrow.mp3', { x: 5000, y: 0 });

    expect(created).toHaveLength(1);
    expect(created[0].volume).toBe(0.6);
  });
});

// A 404 per swing on a busy map is both the network and the server log.
describe('a file the server does not have', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('is asked for once, then never again', async () => {
    const created = fakeAudio();
    const { playSound } = await importAudio();

    playSound('nope.mp3');
    expect(created).toHaveLength(1);
    created[0].fail();

    playSound('nope.mp3');
    playSound('nope.mp3');
    expect(created).toHaveLength(1);

    // a file that never failed is unaffected
    playSound('attack.mp3');
    expect(created).toHaveLength(2);
  });
});
