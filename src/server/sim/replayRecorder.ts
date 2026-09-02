import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientAction } from '../engine/actions.js';
import { config } from '../config.js';
import { getTick } from './clock.js';
import { getSeed } from './rng.js';

/**
 * Records player actions to answer "what happened at 20:03".
 *
 * Captures every action in `processActions`, plus socket open and close.
 * It is player data: starting it is an audited ADMIN command, and nothing
 * is written until an operator saves. Not a save-state: a replay only
 * reproduces the sim from an equal starting world.
 */

/**
 * Socket open and close. Without them a replay would keep the last key
 * held forever, since the server clears held keys on close.
 */
export interface SessionAction {
  type: 'session';
  username: string;
  event: 'join' | 'leave';
}

/** Same `type` and `username` as a client action: readers need no branch. */
export type RecordedAction = ClientAction | SessionAction;

export interface ReplayEvent {
  tick: number;
  /** Wall-clock time; reports use clock time, not ticks. */
  at: number;
  action: RecordedAction;
}

export interface ReplayFile {
  version: 2;
  seed: number;
  startedAt: string;
  label?: string;
  /** Actions the ring dropped before this file was written, oldest first. */
  dropped: number;
  events: ReplayEvent[];
}

export interface RecordingStatus {
  recording: boolean;
  events: number;
  dropped: number;
  capacity: number;
  startedAt: string;
  label?: string;
}

// Ring buffer: bounded memory, keeps the most recent actions.
let _ring: (ReplayEvent | undefined)[] = [];
let _next = 0;
let _count = 0;
let _dropped = 0;
let _recording = false;
let _startedAt = '';
let _label: string | undefined;

function capacity(): number {
  return config.replay.maxEvents;
}

export function startRecording(label?: string): void {
  _ring = new Array<ReplayEvent | undefined>(capacity());
  _next = 0;
  _count = 0;
  _dropped = 0;
  _recording = true;
  _startedAt = new Date().toISOString();
  _label = label;
}

export function stopRecording(): void {
  _recording = false;
}

export function isRecording(): boolean {
  return _recording;
}

/**
 * Records an action as queued, before it runs, so one that makes a handler
 * throw is still recorded.
 */
export function recordAction(action: RecordedAction): void {
  if (!_recording) return;
  if (_count === _ring.length) _dropped++;
  else _count++;
  _ring[_next] = { tick: getTick(), at: Date.now(), action };
  _next = (_next + 1) % _ring.length;
}

/** A socket opening or closing, recorded like any other line in the file. */
export function recordSession(
  username: string,
  event: SessionAction['event'],
): void {
  recordAction({ type: 'session', username, event });
}

/** Buffered actions, oldest first. */
function bufferedEvents(): ReplayEvent[] {
  const size = _ring.length;
  if (size === 0) return [];
  const start = _count === size ? _next : 0;
  const events: ReplayEvent[] = [];
  for (let i = 0; i < _count; i++) {
    const event = _ring[(start + i) % size];
    if (event) events.push(event);
  }
  return events;
}

export function getReplayData(): ReplayFile {
  return {
    version: 2,
    seed: getSeed(),
    startedAt: _startedAt,
    ...(_label ? { label: _label } : {}),
    dropped: _dropped,
    events: bufferedEvents(),
  };
}

export function recordingStatus(): RecordingStatus {
  return {
    recording: _recording,
    events: _count,
    dropped: _dropped,
    capacity: capacity(),
    startedAt: _startedAt,
    ...(_label ? { label: _label } : {}),
  };
}

/** Writes the buffer to disk and keeps recording. */
export function saveReplay(
  label?: string,
  dir = config.replay.dir,
): string | null {
  if (_count === 0) return null;
  if (label) _label = label;
  const data = getReplayData();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = label ? `-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  const filepath = join(dir, `${stamp}${suffix}.json`);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  return filepath;
}

/** Saves whatever is buffered and stops, for shutdown and for `replay stop`. */
export function flushReplay(dir = config.replay.dir): string | null {
  if (!_recording) return null;
  const filepath = saveReplay(undefined, dir);
  _recording = false;
  return filepath;
}

export interface SavedReplay {
  name: string;
  bytes: number;
  savedAt: number;
}

/** Saved recordings, newest first. Never pruned automatically. */
export function listReplays(dir = config.replay.dir): SavedReplay[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const stats = statSync(join(dir, name));
      return { name, bytes: stats.size, savedAt: stats.mtimeMs };
    })
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function resetRecorder(): void {
  _ring = [];
  _next = 0;
  _count = 0;
  _dropped = 0;
  _recording = false;
  _startedAt = '';
  _label = undefined;
}
