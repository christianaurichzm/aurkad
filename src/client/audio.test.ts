import { describe, it, expect, beforeEach, vi } from 'vitest';

// Settings are read from storage at module load, so each case re-imports
// with a fresh registry.
const importAudio = async () => {
  vi.resetModules();
  return import('./audio');
};

const fakeAudio = () => {
  const created: { volume: number }[] = [];
  class FakeAudio {
    volume = 0;
    loop = false;
    src = '';
    constructor() {
      created.push(this);
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
