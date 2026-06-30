import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Key } from '../../shared/types.js';
import { getTick } from './clock.js';
import { getSeed } from './rng.js';

export interface ReplayEvent {
  tick: number;
  username: string;
  key: Key;
  type: 'press' | 'release';
}

export interface ReplayFile {
  version: 1;
  seed: number;
  startedAt: string;
  events: ReplayEvent[];
}

let _recording = false;
let _events: ReplayEvent[] = [];
let _startedAt = '';

export function startRecording(): void {
  _recording = true;
  _events = [];
  _startedAt = new Date().toISOString();
}

export function isRecording(): boolean {
  return _recording;
}

export function recordKeyEvent(
  username: string,
  key: Key,
  type: 'press' | 'release',
): void {
  if (!_recording) return;
  _events.push({ tick: getTick(), username, key, type });
}

export function getReplayData(): ReplayFile {
  return {
    version: 1,
    seed: getSeed(),
    startedAt: _startedAt,
    events: [..._events],
  };
}

export function flushReplay(dir = 'replays'): string | null {
  if (!_recording || _events.length === 0) return null;
  const data = getReplayData();
  mkdirSync(dir, { recursive: true });
  const safe = _startedAt.replace(/[:.]/g, '-');
  const filepath = join(dir, `${safe}.json`);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  _recording = false;
  _events = [];
  return filepath;
}

export function resetRecorder(): void {
  _recording = false;
  _events = [];
  _startedAt = '';
}
