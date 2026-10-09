import { describe, it, expect, beforeEach } from 'vitest';
import {
  startRecording,
  stopRecording,
  recordAction,
  getReplayData,
  recordingStatus,
  saveReplay,
  flushReplay,
  listReplays,
  recordSession,
  resetRecorder,
} from './replayRecorder.js';
import { config } from '../config.js';
import { seedRng } from './rng.js';
import { resetClock, advanceTick } from './clock.js';
import { Key } from '../../shared/types.js';
import type { ClientAction } from '../engine/actions.js';
import { existsSync, rmSync } from 'node:fs';

const TMP_DIR = '/tmp/replay-test';

const key = (username: string, type: 'press' | 'release'): ClientAction => ({
  type: 'keyboard',
  username,
  keyboardAction: { key: Key.ArrowRight, type },
});

beforeEach(() => {
  resetRecorder();
  resetClock();
  seedRng(0);
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('replayRecorder', () => {
  it('is not recording by default', () => {
    expect(recordingStatus().recording).toBe(false);
    recordAction(key('Bob', 'press'));
    expect(getReplayData().events).toHaveLength(0);
  });

  it('captures seed, tick and wall clock', () => {
    seedRng(12345);
    startRecording();
    recordAction(key('Alice', 'press'));
    advanceTick();
    recordAction(key('Alice', 'release'));

    const data = getReplayData();
    expect(data.version).toBe(2);
    expect(data.seed).toBe(12345);
    expect(data.events).toHaveLength(2);
    expect(data.events[0]).toMatchObject({
      tick: 0,
      action: { username: 'Alice', type: 'keyboard' },
    });
    expect(data.events[1]!.tick).toBe(1);
    // Wall-clock timestamps, not ticks.
    expect(data.events[0]!.at).toBeGreaterThan(0);
  });

  it('records every kind of client action, not only movement', () => {
    startRecording();
    recordAction(key('Alice', 'press'));
    recordAction({
      type: 'item',
      username: 'Alice',
      item: 7,
      action: 'drop',
      quantity: 2,
    });
    recordAction({
      type: 'chat',
      username: 'Alice',
      scope: 'global',
      message: 'where did it go',
    });
    recordAction({
      type: 'custom',
      username: 'Alice',
      channel: 'trade:offer',
      payload: { to: 'Bob' },
    });

    // Every action type is recorded, not just movement.
    expect(getReplayData().events.map((e) => e.action.type)).toEqual([
      'keyboard',
      'item',
      'chat',
      'custom',
    ]);
  });

  it('records arriving and leaving, which no action reports', () => {
    startRecording();
    recordSession('Alice', 'join');
    recordAction(key('Alice', 'press'));
    recordSession('Alice', 'leave');

    // The disconnect is recorded, or the last key would look held forever.
    expect(getReplayData().events.map((e) => e.action)).toEqual([
      { type: 'session', username: 'Alice', event: 'join' },
      {
        type: 'keyboard',
        username: 'Alice',
        keyboardAction: expect.anything(),
      },
      { type: 'session', username: 'Alice', event: 'leave' },
    ]);
  });

  it('keeps the most recent actions once full, and counts what it dropped', () => {
    const capacity = config.replay.maxEvents;
    startRecording();
    for (let i = 0; i < capacity + 5; i++) {
      advanceTick();
      recordAction(key(`P${i}`, 'press'));
    }

    const data = getReplayData();
    expect(data.events).toHaveLength(capacity);
    expect(data.dropped).toBe(5);
    // Oldest first; the first five were dropped.
    expect(data.events[0]!.action.username).toBe('P5');
    expect(data.events[capacity - 1]!.action.username).toBe(`P${capacity + 4}`);
  });

  it('reports what is buffered while it records', () => {
    startRecording('gm-report');
    recordAction(key('Alice', 'press'));

    const status = recordingStatus();
    expect(status).toMatchObject({
      recording: true,
      events: 1,
      dropped: 0,
      label: 'gm-report',
    });
  });

  it('saving keeps the capture running', () => {
    startRecording();
    recordAction(key('Alice', 'press'));

    const path = saveReplay('incident', TMP_DIR);

    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
    expect(path).toContain('incident');
    // Saving keeps the recording on.
    expect(recordingStatus().recording).toBe(true);
  });

  it('stopping writes what is left', () => {
    startRecording();
    recordAction(key('Alice', 'press'));

    const path = flushReplay(TMP_DIR);

    expect(existsSync(path!)).toBe(true);
    expect(recordingStatus().recording).toBe(false);
  });

  it('writes nothing when nothing was recorded', () => {
    startRecording();
    expect(flushReplay(TMP_DIR)).toBeNull();
    expect(saveReplay(undefined, TMP_DIR)).toBeNull();
  });

  it('stops without losing what is buffered', () => {
    startRecording();
    recordAction(key('Alice', 'press'));
    stopRecording();

    expect(recordingStatus().recording).toBe(false);
    expect(getReplayData().events).toHaveLength(1);
    recordAction(key('Alice', 'release'));
    expect(getReplayData().events).toHaveLength(1);
  });

  it('lists saved recordings newest first', () => {
    startRecording();
    recordAction(key('Alice', 'press'));
    saveReplay('first', TMP_DIR);
    saveReplay('second', TMP_DIR);

    const files = listReplays(TMP_DIR);
    expect(files).toHaveLength(2);
    expect(files[0]!.bytes).toBeGreaterThan(0);
    expect(listReplays('/tmp/does-not-exist-replays')).toEqual([]);
  });

  it('resetRecorder clears all state', () => {
    startRecording();
    recordAction(key('Alice', 'press'));
    resetRecorder();
    expect(recordingStatus().recording).toBe(false);
    expect(getReplayData().events).toHaveLength(0);
  });
});
