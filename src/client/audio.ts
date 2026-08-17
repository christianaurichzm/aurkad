import { TILE_SIZE } from '../shared/constants';
import type { Position } from '../shared/types';

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

/**
 * How far a placed sound carries: twelve tiles, a little under two screens,
 * so a distant fight is faint and a busy map does not play every arrow.
 */
const AUDIBLE_TILES = 12;
const AUDIBLE_RANGE = AUDIBLE_TILES * TILE_SIZE;

// Where the ears are, pushed in by the sync loop. Kept here so this module
// stays a leaf the sync layer can import without a cycle.
let listener: Position | null = null;

export function setAudioListener(position: Position | null): void {
  listener = position ? { ...position } : null;
}

/**
 * How loud a sound at `at` is for a listener at `from`, and how far to the
 * side. Linear falloff reads as close or far; `null` is out of earshot.
 */
export function spatialMix(
  at: Position,
  from: Position,
  effects: number,
): { volume: number; pan: number } | null {
  const dx = at.x - from.x;
  const distance = Math.hypot(dx, at.y - from.y);
  if (distance >= AUDIBLE_RANGE) return null;
  return {
    volume: effects * (1 - distance / AUDIBLE_RANGE),
    pan: Math.max(-1, Math.min(1, dx / AUDIBLE_RANGE)),
  };
}

// A missing file would 404 on every play, so one miss stops further
// requests for the session.
const missing = new Set<string>();

// undefined = not tried yet, null = this browser has no graph to offer.
let audioCtx: AudioContext | null | undefined;

/**
 * Routes one clip through a stereo panner when the browser offers a graph.
 * The element carries the volume either way, and the nodes are dropped when
 * the clip ends so the graph does not grow.
 */
function pan(el: HTMLAudioElement, value: number): void {
  try {
    if (audioCtx === undefined) {
      audioCtx =
        typeof AudioContext === 'undefined' ? null : new AudioContext();
    }
    if (!audioCtx) return;
    if (audioCtx.state !== 'running') {
      void audioCtx.resume();
      return;
    }
    const source = audioCtx.createMediaElementSource(el);
    const panner = new StereoPannerNode(audioCtx, { pan: value });
    source.connect(panner).connect(audioCtx.destination);
    el.addEventListener('ended', () => {
      source.disconnect();
      panner.disconnect();
    });
  } catch {
    // A browser that refuses the graph still has the element.
  }
}

/**
 * One effect. With `at` it is placed in the world, quieter with distance
 * and off to the side, and silent past `AUDIBLE_TILES`. Before the first
 * world update it plays flat rather than not at all.
 */
export function playSound(file: string, at?: Position): void {
  if (settings.muted || settings.effects === 0 || missing.has(file)) return;

  let volume = settings.effects;
  let side = 0;
  if (at && listener) {
    const mix = spatialMix(at, listener, settings.effects);
    if (!mix) return;
    volume = mix.volume;
    side = mix.pan;
  }

  const el = new Audio(`/audio/${file}`);
  el.volume = volume;
  el.addEventListener('error', () => missing.add(file));
  if (side !== 0) pan(el, side);
  el.play().catch(() => {});
}
