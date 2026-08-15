export interface AudioSettings {
  music: number;
  effects: number;
  muted: boolean;
}

const STORAGE_KEY = 'audio';
const DEFAULTS: AudioSettings = { music: 0.4, effects: 0.6, muted: false };

// HTMLMediaElement.volume throws outside 0..1 and storage is user-editable,
// so the value is clamped on the way in.
function normalize(raw: Partial<AudioSettings>): AudioSettings {
  const level = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback;

  return {
    music: level(raw.music, DEFAULTS.music),
    effects: level(raw.effects, DEFAULTS.effects),
    muted: raw.muted === true,
  };
}

function load(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw
      ? normalize(JSON.parse(raw) as Partial<AudioSettings>)
      : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = load();
let musicEl: HTMLAudioElement | null = null;
let currentMusic = '';

// Mute scales the volume instead of pausing, so unmuting resumes the track
// where it is rather than restarting it.
const musicVolume = () => (settings.muted ? 0 : settings.music);

export function getAudioSettings(): AudioSettings {
  return { ...settings };
}

export function setAudioSettings(patch: Partial<AudioSettings>): void {
  settings = normalize({ ...settings, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled (private mode): the setting still applies this session.
  }
  if (musicEl) musicEl.volume = musicVolume();
}

export function playMusic(file: string): void {
  if (currentMusic === file) return;
  stopMusic();
  currentMusic = file;
  musicEl = new Audio(`/audio/${file}`);
  musicEl.loop = true;
  musicEl.volume = musicVolume();
  musicEl.play().catch(() => {
    // Autoplay may be blocked until user interaction; acceptable.
  });
}

export function stopMusic(): void {
  if (musicEl) {
    musicEl.pause();
    musicEl.src = '';
    musicEl = null;
  }
  currentMusic = '';
}

export function playSound(file: string): void {
  if (settings.muted || settings.effects === 0) return;
  const el = new Audio(`/audio/${file}`);
  el.volume = settings.effects;
  el.play().catch(() => {});
}
