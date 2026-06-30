import { describe, it, expect, beforeEach } from 'vitest';
import {
  startRecording,
  recordKeyEvent,
  getReplayData,
  isRecording,
  flushReplay,
  resetRecorder,
} from './replayRecorder.js';
import { seedRng } from './rng.js';
import { resetClock, advanceTick } from './clock.js';
import { Key } from '../../shared/types.js';
import { existsSync, unlinkSync, rmdirSync } from 'fs';

const TMP_DIR = '/tmp/replay-test';

beforeEach(() => {
  resetRecorder();
  resetClock();
  seedRng(0);
});

describe('replayRecorder', () => {
  it('is not recording by default', () => {
    expect(isRecording()).toBe(false);
  });

  it('starts recording', () => {
    startRecording();
    expect(isRecording()).toBe(true);
  });

  it('captures seed and events', () => {
    seedRng(12345);
    startRecording();
    recordKeyEvent('Alice', Key.ArrowRight, 'press');
    advanceTick();
    recordKeyEvent('Alice', Key.ArrowRight, 'release');

    const data = getReplayData();
    expect(data.version).toBe(1);
    expect(data.seed).toBe(12345);
    expect(data.startedAt).toBeTruthy();
    expect(data.events).toHaveLength(2);
    expect(data.events[0]).toMatchObject({
      tick: 0,
      username: 'Alice',
      key: Key.ArrowRight,
      type: 'press',
    });
    expect(data.events[1]).toMatchObject({ tick: 1, type: 'release' });
  });

  it('records tick numbers correctly', () => {
    startRecording();
    advanceTick();
    advanceTick();
    recordKeyEvent('Bob', Key.ArrowDown, 'press');

    const data = getReplayData();
    expect(data.events[0]!.tick).toBe(2);
  });

  it('ignores events when not recording', () => {
    recordKeyEvent('Bob', Key.ArrowDown, 'press');
    startRecording();
    expect(getReplayData().events).toHaveLength(0);
  });

  it('getReplayData returns a copy (mutation-safe)', () => {
    startRecording();
    recordKeyEvent('Alice', Key.ArrowLeft, 'press');
    const a = getReplayData();
    recordKeyEvent('Alice', Key.ArrowLeft, 'release');
    const b = getReplayData();
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(2);
  });

  it('flushReplay writes a file and stops recording', () => {
    startRecording();
    recordKeyEvent('Alice', Key.ArrowUp, 'press');

    const path = flushReplay(TMP_DIR);
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
    expect(isRecording()).toBe(false);

    unlinkSync(path!);
    rmdirSync(TMP_DIR);
  });

  it('flushReplay returns null when nothing was recorded', () => {
    startRecording();
    expect(flushReplay(TMP_DIR)).toBeNull();
  });

  it('resetRecorder clears all state', () => {
    startRecording();
    recordKeyEvent('Alice', Key.ArrowRight, 'press');
    resetRecorder();
    expect(isRecording()).toBe(false);
    expect(getReplayData().events).toHaveLength(0);
  });
});
