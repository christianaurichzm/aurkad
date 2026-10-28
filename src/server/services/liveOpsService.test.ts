/**
 * Live-ops flags: one takes effect without a restart, starts and stops on
 * its own clock, and survives a restart. Against a real (in-memory)
 * MongoDB, since "survives a restart" means a reload re-reads what was
 * written. Only Date is faked, so the driver's own timers keep working.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';
import LiveOpsFlagModel from '../model/LiveOpsFlag.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const {
  getFlag,
  flagEnabled,
  flagNumber,
  listFlags,
  setFlag,
  clearFlag,
  sweepLiveOpsFlags,
  loadLiveOpsFlags,
  startLiveOps,
  clearLiveOpsFlagsForTest,
  XP_MULTIPLIER_FLAG,
} = await import('./liveOpsService.js');

const { on, emit, clearAll } = await import('../engine/hooks.js');
const { awardExperience } = await import('./player/playerService.js');
const { resetScheduler } = await import('../sim/scheduler.js');

beforeEach(async () => {
  await LiveOpsFlagModel.deleteMany({});
  clearLiveOpsFlagsForTest();
  clearAll();
  resetScheduler();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fakes the clock only, so the MongoDB driver's own timers keep running. */
function freezeClockAt(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

/** Records every start/end edge scripts would see. */
function watchEdges() {
  const seen: Array<{ name: string; active: boolean }> = [];
  on('liveOpsFlag', ({ name, active }) => seen.push({ name, active }));
  return seen;
}

describe('reading flags', () => {
  it('takes effect the moment it is set, with no reload', async () => {
    expect(flagEnabled('winterEvent')).toBe(false);
    await setFlag('winterEvent', true);
    expect(flagEnabled('winterEvent')).toBe(true);
  });

  it('treats only boolean true as enabled', async () => {
    await setFlag('zero', 0);
    await setFlag('empty', '');
    await setFlag('word', 'true');
    expect(flagEnabled('zero')).toBe(false);
    expect(flagEnabled('empty')).toBe(false);
    expect(flagEnabled('word')).toBe(false);
  });

  it('falls back rather than handing a caller a non-number', async () => {
    await setFlag('rate', 'plenty');
    // A multiplier is about to be applied to a player's experience, so the
    // fallback matters more than reporting the operator's typo here.
    expect(flagNumber('rate', 1)).toBe(1);
    expect(flagNumber('missing', 3)).toBe(3);
    await setFlag('rate', 2.5);
    expect(flagNumber('rate', 1)).toBe(2.5);
  });

  it('records who set it and why', async () => {
    await setFlag('bossWeek', true, { setBy: 'ana', note: 'launch week' });
    expect(getFlag('bossWeek')).toMatchObject({
      setBy: 'ana',
      note: 'launch week',
    });
  });
});

describe('expiry', () => {
  it('stops applying once the time is up', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');

    await setFlag(XP_MULTIPLIER_FLAG, 2, {
      expiresAt: Date.now() + 60_000,
    });
    expect(flagNumber(XP_MULTIPLIER_FLAG, 1)).toBe(2);

    vi.setSystemTime(new Date('2026-07-30T12:01:01Z'));
    expect(flagNumber(XP_MULTIPLIER_FLAG, 1)).toBe(1);
    expect(getFlag(XP_MULTIPLIER_FLAG)).toBeUndefined();
  });

  it('leaves the row to the sweep, so a read never writes', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    await setFlag('brief', true, { expiresAt: Date.now() + 1_000 });
    vi.setSystemTime(new Date('2026-07-30T12:00:02Z'));
    const deleteOne = vi.spyOn(LiveOpsFlagModel, 'deleteOne');

    // The read happens inside the tick; a write per read would be a write per
    // frame for as long as nobody clears the flag.
    getFlag('brief');
    getFlag('brief');
    getFlag('brief');
    expect(deleteOne).not.toHaveBeenCalled();

    sweepLiveOpsFlags();
    sweepLiveOpsFlags();
    expect(deleteOne).toHaveBeenCalledTimes(1);
    deleteOne.mockRestore();

    // The sweep does not wait for the delete either, as the flag stopped
    // applying when its clock said so; the row goes a moment later.
    await vi.waitFor(async () =>
      expect(await LiveOpsFlagModel.countDocuments({ name: 'brief' })).toBe(0),
    );
  });

  it('keeps a row another instance set again before this one heard', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    await setFlag(XP_MULTIPLIER_FLAG, 2, { expiresAt: Date.now() + 1_000 });
    await LiveOpsFlagModel.replaceOne(
      { name: XP_MULTIPLIER_FLAG },
      { name: XP_MULTIPLIER_FLAG, value: 3, setAt: new Date() },
    );
    vi.setSystemTime(new Date('2026-07-30T12:00:02Z'));
    const deletes: Promise<unknown>[] = [];
    const deleteOne = LiveOpsFlagModel.deleteOne.bind(LiveOpsFlagModel);
    const spy = vi
      .spyOn(LiveOpsFlagModel, 'deleteOne')
      .mockImplementation((filter) => {
        const done = deleteOne(filter).exec();
        deletes.push(done);
        return done as never;
      });

    sweepLiveOpsFlags();
    await Promise.all(deletes);
    spy.mockRestore();

    expect(deletes).toHaveLength(1);
    expect(
      await LiveOpsFlagModel.countDocuments({ name: XP_MULTIPLIER_FLAG }),
    ).toBe(1);
  });

  it('keeps a flag with no expiry until someone clears it', async () => {
    await setFlag('forever', true);
    expect(await clearFlag('forever')).toBe(true);
    expect(flagEnabled('forever')).toBe(false);
    expect(await clearFlag('forever')).toBe(false);
  });

  it('hides expired flags from the listing', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    await setFlag('live', true);
    await setFlag('done', true, { expiresAt: Date.now() + 1_000 });

    vi.setSystemTime(new Date('2026-07-30T12:00:02Z'));
    expect(listFlags().map((f) => f.name)).toEqual(['live']);
  });
});

describe('scheduling', () => {
  it('does not apply before its start time, but is visible to the operator', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    await setFlag(XP_MULTIPLIER_FLAG, 2, {
      startsAt: Date.now() + 3_600_000,
    });

    expect(flagNumber(XP_MULTIPLIER_FLAG, 1)).toBe(1);
    expect(getFlag(XP_MULTIPLIER_FLAG)).toBeUndefined();
    // Invisible to the game but not to whoever scheduled it, or the only way
    // to check it is to wait for it.
    expect(listFlags().map((f) => f.name)).toEqual([XP_MULTIPLIER_FLAG]);
  });

  it('applies on its own once the time arrives', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    await setFlag(XP_MULTIPLIER_FLAG, 2, {
      startsAt: Date.now() + 3_600_000,
      expiresAt: Date.now() + 7_200_000,
    });

    vi.setSystemTime(new Date('2026-07-30T13:00:01Z'));
    expect(flagNumber(XP_MULTIPLIER_FLAG, 1)).toBe(2);

    vi.setSystemTime(new Date('2026-07-30T14:00:01Z'));
    expect(flagNumber(XP_MULTIPLIER_FLAG, 1)).toBe(1);
  });

  it('tells scripts when the event starts and when it ends, once each', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    const seen = watchEdges();

    await setFlag('bossWeek', true, {
      startsAt: Date.now() + 60_000,
      expiresAt: Date.now() + 120_000,
    });
    sweepLiveOpsFlags();
    // Nothing yet: the boss spawns when the event starts, not when it is set.
    expect(seen).toEqual([]);

    vi.setSystemTime(new Date('2026-07-30T12:01:01Z'));
    sweepLiveOpsFlags();
    sweepLiveOpsFlags();
    expect(seen).toEqual([{ name: 'bossWeek', active: true }]);

    vi.setSystemTime(new Date('2026-07-30T12:02:01Z'));
    sweepLiveOpsFlags();
    sweepLiveOpsFlags();
    expect(seen).toEqual([
      { name: 'bossWeek', active: true },
      { name: 'bossWeek', active: false },
    ]);
  });

  it('announces a flag that starts at once without waiting for the sweep', async () => {
    const seen = watchEdges();
    await setFlag('winterEvent', true);
    // The operator typed the command and expects the event running by the time
    // it answers, not up to a second later.
    expect(seen).toEqual([{ name: 'winterEvent', active: true }]);
  });

  it('says nothing about a flag cancelled before it ever started', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    const seen = watchEdges();

    await setFlag('bossWeek', true, { startsAt: Date.now() + 60_000 });
    await clearFlag('bossWeek');
    sweepLiveOpsFlags();

    expect(seen).toEqual([]);
  });

  it('ends the event when an operator clears a running flag', async () => {
    const seen = watchEdges();
    await setFlag('winterEvent', true);
    await clearFlag('winterEvent');
    expect(seen).toEqual([
      { name: 'winterEvent', active: true },
      { name: 'winterEvent', active: false },
    ]);
  });

  it('registers the sweep on the tick clock, not on a wall-clock timer', async () => {
    const { scheduledTaskCount } = await import('../sim/scheduler.js');
    startLiveOps();
    // Anything gameplay-related scheduled off the simulation's beat is
    // invisible to the replay recorder (sim/scheduler.ts).
    expect(scheduledTaskCount()).toBe(1);
  });
});

describe('surviving a restart', () => {
  it('reloads a flag that was still running', async () => {
    await setFlag('winterEvent', true, { setBy: 'ana' });

    clearLiveOpsFlagsForTest();
    expect(flagEnabled('winterEvent')).toBe(false);

    await loadLiveOpsFlags();

    expect(flagEnabled('winterEvent')).toBe(true);
    expect(getFlag('winterEvent')?.setBy).toBe('ana');
  });

  it('keeps one scheduled for later, and starts it on time', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    await setFlag('bossWeek', true, { startsAt: Date.now() + 3_600_000 });

    // The process that took the command is not the one that will run the
    // event: the start time has to be a row, not a timer.
    clearLiveOpsFlagsForTest();
    await loadLiveOpsFlags();
    expect(flagEnabled('bossWeek')).toBe(false);

    vi.setSystemTime(new Date('2026-07-30T13:00:01Z'));
    expect(flagEnabled('bossWeek')).toBe(true);
  });

  it('does not replay the start of an event that was already running', async () => {
    await setFlag('winterEvent', true);

    clearLiveOpsFlagsForTest();
    const seen = watchEdges();
    await loadLiveOpsFlags();
    sweepLiveOpsFlags();

    // A restart in the middle of a week-long event must not re-run whatever the
    // script does at the start. Current state is `flags.enabled`, not the edge.
    expect(seen).toEqual([]);
    expect(flagEnabled('winterEvent')).toBe(true);
  });

  it('forgets a schedule the flag was set again without', async () => {
    await setFlag('bossWeek', true, {
      startsAt: Date.now() + 3_600_000,
      expiresAt: Date.now() + 7_200_000,
    });
    await setFlag('bossWeek', true);

    clearLiveOpsFlagsForTest();
    await loadLiveOpsFlags();

    expect(flagEnabled('bossWeek')).toBe(true);
  });

  it('drops one whose time passed while the server was down', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    await setFlag('overnight', true, { expiresAt: Date.now() + 60_000 });

    vi.setSystemTime(new Date('2026-07-31T12:00:00Z'));
    clearLiveOpsFlagsForTest();
    await loadLiveOpsFlags();

    expect(flagEnabled('overnight')).toBe(false);
    // Not just hidden: a flag nobody will ever read again should not be a row
    // the next boot has to look at either.
    expect(await LiveOpsFlagModel.countDocuments({ name: 'overnight' })).toBe(
      0,
    );
  });

  it('ignores a stored value that is not a scalar', async () => {
    await LiveOpsFlagModel.create({
      name: 'broken',
      value: { nested: true },
      setAt: new Date(),
    });
    await loadLiveOpsFlags();
    expect(getFlag('broken')).toBeUndefined();
  });

  it('still applies the flag when the database is unreachable', async () => {
    await mongoose.disconnect();
    try {
      // No ten-second buffer: the operator gets an answer at once, and the log
      // records that this one will not outlive the process.
      const started = Date.now();
      await setFlag('urgent', true);
      expect(flagEnabled('urgent')).toBe(true);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      await mongoose.connect(mongod.getUri());
    }
  });
});

describe('the engine acting on xpMultiplier', () => {
  it('scales earned experience while the flag is on', async () => {
    startLiveOps();
    const player = { experience: 0, experienceToNextLevel: 1e9 } as never;

    expect(awardExperience(player, 100, 'test')).toBe(100);

    await setFlag(XP_MULTIPLIER_FLAG, 2);
    expect(awardExperience(player, 100, 'test')).toBe(200);

    await clearFlag(XP_MULTIPLIER_FLAG);
    expect(awardExperience(player, 100, 'test')).toBe(100);
  });

  it('composes with a module scaling the same number', async () => {
    startLiveOps();
    // A party or guild bonus is another handler on the same hook; the flag
    // must multiply with it rather than replace it.
    on('beforeXpGain', (ctx) => {
      ctx.amount *= 1.5;
    });

    await setFlag(XP_MULTIPLIER_FLAG, 2);
    const player = { experience: 0, experienceToNextLevel: 1e9 } as never;

    expect(awardExperience(player, 100, 'test')).toBe(300);
  });

  it('leaves experience alone when no flag is set', () => {
    startLiveOps();
    const ctx = { player: null as never, amount: 50, source: 'test', base: 50 };
    emit('beforeXpGain', ctx);
    expect(ctx.amount).toBe(50);
  });

  it('waits for the scheduled start before doubling anything', async () => {
    freezeClockAt('2026-07-30T12:00:00Z');
    startLiveOps();
    const player = { experience: 0, experienceToNextLevel: 1e9 } as never;

    await setFlag(XP_MULTIPLIER_FLAG, 2, { startsAt: Date.now() + 60_000 });
    expect(awardExperience(player, 100, 'test')).toBe(100);

    vi.setSystemTime(new Date('2026-07-30T12:01:01Z'));
    expect(awardExperience(player, 100, 'test')).toBe(200);
  });
});
