import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerCommand,
  handleWebCommand,
  clearCommands,
} from '../engine/commands.js';
import { registerServerCommands } from './serverCommands.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { serverState } from '../services/world/serverState.js';
import { Access } from '../../shared/types.js';
import { createFixture } from '../sim/simFixture.js';
import {
  clearLiveOpsFlagsForTest,
  getFlag,
  listFlags,
} from '../services/liveOpsService.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import {
  isRecording,
  recordAction,
  resetRecorder,
} from '../sim/replayRecorder.js';
import { existsSync, rmSync } from 'fs';

// Awaited: a handler that reads the database replies after its first await,
// and the web console serialises the collected replies into one response.
const run = async (
  line: string,
  accessLevel = Access.ADMIN,
  actor?: string,
) => {
  const [name, ...args] = line.split(/\s+/);
  const out: string[] = [];
  const matched = await handleWebCommand(
    name!,
    args,
    accessLevel,
    (m) => out.push(m),
    actor,
  );
  return { matched, out };
};

beforeEach(() => {
  clearCommands();
  drainGameEvents();
  serverState.mode = 'normal';
  serverState.motd = '';
  serverState.mutes.clear();
});

afterEach(() => clearCommands());

describe('handleWebCommand access', () => {
  it('runs a command the caller has access to', async () => {
    registerCommand('ping', { access: Access.MOD }, ({ reply }) =>
      reply('pong'),
    );
    expect(await run('ping', Access.ADMIN)).toEqual({
      matched: true,
      out: ['pong'],
    });
  });

  it('refuses a command above the caller access level', async () => {
    registerCommand('danger', { access: Access.ADMIN }, ({ reply }) =>
      reply('boom'),
    );
    const { matched, out } = await run('danger', Access.MOD);
    expect(matched).toBe(true);
    expect(out[0]).toMatch(/permission/i);
  });

  it('reports no match for an unknown command', async () => {
    expect((await run('nope')).matched).toBe(false);
  });
});

describe('server ops commands', () => {
  beforeEach(() => registerServerCommands());

  it('broadcast queues a global chat event', async () => {
    const { out } = await run('broadcast hello world');
    expect(out).toEqual(['Broadcast sent: hello world']);
    const events = drainGameEvents();
    expect(events).toEqual([
      {
        type: 'chatGlobal',
        payload: { type: 'chat', scope: 'global', message: 'hello world' },
      },
    ]);
  });

  it('mode sets the server mode and rejects invalid values', async () => {
    expect((await run('mode maintenance')).out[0]).toMatch(/maintenance/);
    expect(serverState.mode).toBe('maintenance');
    await run('mode bogus');
    expect(serverState.mode).toBe('maintenance');
  });

  it('mode announces the restriction to the players it affects', async () => {
    drainGameEvents();
    await run('mode maintenance');

    expect(drainGameEvents()).toContainEqual(
      expect.objectContaining({ type: 'chatGlobal' }),
    );
  });

  it('mode with no argument reads it back', async () => {
    serverState.mode = 'gm_only';
    expect((await run('mode')).out[0]).toMatch(/gm_only/);
    expect(serverState.mode).toBe('gm_only');
  });

  it('motd sets, reads and clears the message of the day', async () => {
    await run('motd Event at 8pm');
    expect(serverState.motd).toBe('Event at 8pm');

    // Reading it must not lose it: a bare `motd` shows the notice and
    // leaves it set.
    expect((await run('motd')).out[0]).toContain('Event at 8pm');
    expect(serverState.motd).toBe('Event at 8pm');

    await run('motd clear');
    expect(serverState.motd).toBe('');
  });

  it('maps lists the active maps with what is on them', async () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    sim.addNpc({});

    const { out } = await run('maps');

    expect(out[0]).toContain('Active maps');
    expect(out[1]).toContain('players:1');
    expect(out[1]).toContain('npcs:1');
  });
});

// The command is the only way to set a flag, so its parsing is the whole
// operator interface: one mistyped word is the difference between a two-hour
// event and a permanent one.
describe('flag', () => {
  beforeEach(() => {
    registerServerCommands();
    clearLiveOpsFlagsForTest();
    // No database in this suite: the flag applies in memory and the service
    // logs that it will not outlive the process. That path is covered in
    // liveOpsService.test.ts; here it is just noise.
    vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('reports when nothing is on, then lists what is', async () => {
    expect((await run('flag')).out).toEqual(['No live-ops flags are set.']);

    await run('flag winterEvent true snow everywhere', Access.ADMIN, 'ana');

    expect((await run('flag')).out).toEqual([
      'winterEvent = true, by ana - snow everywhere',
    ]);
  });

  it('reads a bare number as a number and true/false as a switch', async () => {
    await run('flag xpMultiplier 2.5');
    await run('flag winterEvent true');
    await run('flag pvp false');
    await run('flag season summer');

    expect(getFlag('xpMultiplier')?.value).toBe(2.5);
    expect(getFlag('winterEvent')?.value).toBe(true);
    expect(getFlag('pvp')?.value).toBe(false);
    expect(getFlag('season')?.value).toBe('summer');
  });

  it('expires a flag given a duration in minutes', async () => {
    const { out } = await run('flag xpMultiplier 2 120 launch weekend');

    const expiresAt = getFlag('xpMultiplier')?.expiresAt ?? 0;
    expect(expiresAt - Date.now()).toBeGreaterThan(119 * 60_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(120 * 60_000);
    expect(out[0]).toContain('2h left');
    expect(getFlag('xpMultiplier')?.note).toBe('launch weekend');
  });

  it('takes the duration as a keyword too', async () => {
    await run('flag xpMultiplier 2 for 30 short one');

    const expiresAt = getFlag('xpMultiplier')?.expiresAt ?? 0;
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect(getFlag('xpMultiplier')?.note).toBe('short one');
  });

  it('treats a third word that is not a duration as the note', async () => {
    await run('flag winterEvent true snow everywhere');

    // Otherwise `flag event true winter` would quietly set an expiry of NaN
    // minutes on a flag the operator meant to leave running.
    expect(getFlag('winterEvent')?.expiresAt).toBeUndefined();
    expect(getFlag('winterEvent')?.note).toBe('snow everywhere');
  });

  it('records the account that set it, not just the flag', async () => {
    await run('flag xpMultiplier 2', Access.ADMIN, 'ana');
    expect(getFlag('xpMultiplier')?.setBy).toBe('ana');
  });

  it('clears a flag and says so when there was nothing to clear', async () => {
    await run('flag xpMultiplier 2');

    expect((await run('flag xpMultiplier clear')).out).toEqual([
      'Flag xpMultiplier cleared.',
    ]);
    expect(getFlag('xpMultiplier')).toBeUndefined();
    expect((await run('flag xpMultiplier off')).out).toEqual([
      'No flag named xpMultiplier.',
    ]);
  });

  it('explains itself instead of guessing at a missing value', async () => {
    const { out } = await run('flag xpMultiplier');
    expect(out[0]).toMatch(/^Usage: flag <name> <value>/);
    expect(getFlag('xpMultiplier')).toBeUndefined();
  });

  // Scheduling is the half an operator cannot fake by staying up until 8pm.
  it('schedules for the next time the clock reads that hour', async () => {
    const { out } = await run('flag xpMultiplier 2 at 20:00 for 120 saturday');

    // Local time: an operator types the clock on the wall, and the server's
    // wall is the one that counts.
    const startsAt = listFlags()[0]?.startsAt ?? 0;
    expect(startsAt).toBeGreaterThan(Date.now());
    expect(new Date(startsAt).getHours()).toBe(20);
    expect(new Date(startsAt).getMinutes()).toBe(0);
    // Not running yet, so the game must not see it.
    expect(getFlag('xpMultiplier')).toBeUndefined();
    expect(out[0]).toContain('starts in');
    expect(out[0]).toContain('for 2h');
  });

  it('counts the duration from the start, not from now', async () => {
    await run('flag xpMultiplier 2 at +2h for 30 evening');

    const flag = listFlags()[0];
    expect((flag?.startsAt ?? 0) - Date.now()).toBeGreaterThan(119 * 60_000);
    expect((flag?.expiresAt ?? 0) - (flag?.startsAt ?? 0)).toBe(30 * 60_000);
    expect(flag?.note).toBe('evening');
  });

  it('lets the note keep words that look like keywords', async () => {
    await run('flag sale true winter sale at half price');

    // `at` counts as a keyword only before the note starts; after that the
    // operator is writing prose, not a timestamp.
    expect(getFlag('sale')?.note).toBe('winter sale at half price');
    expect(getFlag('sale')?.startsAt).toBeUndefined();
  });

  it('refuses a time it cannot read instead of guessing a day', async () => {
    const { out } = await run('flag xpMultiplier 2 at saturday');
    expect(out[0]).toMatch(/cannot read "saturday" as a time/);
    expect(listFlags()).toEqual([]);
  });

  it('refuses a start time that already went by', async () => {
    const { out } = await run('flag xpMultiplier 2 at 2020-01-01T20:00');
    expect(out[0]).toMatch(/already passed/);
    expect(listFlags()).toEqual([]);
  });

  it('is not a command an ordinary moderator can run', async () => {
    const { out } = await run('flag xpMultiplier 2', Access.MOD);
    expect(out[0]).toMatch(/permission/i);
    expect(getFlag('xpMultiplier')).toBeUndefined();
  });
});

// REPLAY_RECORD is read at boot, and a restart ends the session somebody
// wants to see, so recording is a command. The recorder itself is covered in
// replayRecorder.test.ts; this tests the operator interface over it.
describe('replay', () => {
  const TMP_DIR = '/tmp/replay-command-test';
  // The command writes where the operator's config points; the test points it
  // somewhere disposable instead of dropping recordings into the repo.
  const replayConfig = config.replay as { dir: string };
  const configuredDir = replayConfig.dir;

  beforeEach(() => {
    registerServerCommands();
    resetRecorder();
    replayConfig.dir = TMP_DIR;
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    replayConfig.dir = configuredDir;
    resetRecorder();
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('says it is not recording, and how to start', async () => {
    const { out } = await run('replay');
    expect(out[0]).toMatch(/Not recording.*replay start/);
  });

  it('starts a labelled recording and reports what is buffered', async () => {
    await run('replay start item loss');
    recordAction({
      type: 'chat',
      username: 'Alice',
      scope: 'global',
      message: 'my sword is gone',
    });

    const { out } = await run('replay');
    expect(out[0]).toContain('recording');
    expect(out[0]).toContain('item loss');
    expect(out[0]).toContain('1 actions');
  });

  it('saves without ending the capture', async () => {
    await run('replay start');
    recordAction({
      type: 'item',
      username: 'Alice',
      item: 3,
      action: 'drop',
    });

    const { out } = await run('replay save incident');
    const path = out[0]!.match(/Saved (\S+)/)?.[1];
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
    expect(isRecording()).toBe(true);
    // The file is only half the feature; reading it is the other half.
    expect(out[0]).toContain('npm run replay --');
  });

  it('stop writes what is buffered and ends the capture', async () => {
    await run('replay start');
    recordAction({
      type: 'chat',
      username: 'Alice',
      scope: 'map',
      message: 'still here',
    });

    const { out } = await run('replay stop');
    expect(out[0]).toContain('recording stopped');
    expect(isRecording()).toBe(false);
  });

  it('stop with nothing buffered writes no file and says so', async () => {
    await run('replay start');
    const { out } = await run('replay stop');
    expect(out[0]).toMatch(/no file written, recording stopped/);
    expect(isRecording()).toBe(false);
    expect(existsSync(TMP_DIR)).toBe(false);
  });

  it('lists what was saved', async () => {
    await run('replay start');
    recordAction({
      type: 'custom',
      username: 'Bob',
      channel: 'trade:offer',
    });
    await run('replay save first');

    const { out } = await run('replay list');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('first');
  });

  it('answers an unknown subcommand with the usage', async () => {
    const { out } = await run('replay wat');
    expect(out[0]).toMatch(/^Usage: replay/);
  });

  it('is not a command an ordinary moderator can run', async () => {
    const { out } = await run('replay start', Access.MOD);
    expect(out[0]).toMatch(/permission/i);
    expect(isRecording()).toBe(false);
  });
});
