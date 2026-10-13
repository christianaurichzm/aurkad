/**
 * Coroutines over the tick. A sequence resumes on the tick it asked for and
 * nowhere else, or replay breaks. A reload takes its coroutines with it, or
 * old code runs against the new world. Every resumption is charged to the
 * script, so coroutine time is not hidden from the accounting.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetClock, advanceTick } from '../../sim/clock.js';
import {
  runScheduledTasks,
  resetScheduler,
  scheduledTaskCount,
} from '../../sim/scheduler.js';
import { clearAll, emit } from '../hooks.js';
import {
  activeCoroutineCount,
  resetCoroutines,
  startCoroutine,
  wait,
  waitFor,
} from './coroutines.js';
import {
  clearHandlerBudget,
  handlerCosts,
  isHandlerDisabled,
} from './handlerBudget.js';
import { clearScriptErrors, getScriptErrors } from './scriptErrors.js';
import { runInSandbox } from './sandbox.js';
import { buildApi } from './api.js';
import { config } from '../../config.js';

// One simulated tick: advance the clock, then drain what is due.
function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    advanceTick();
    runScheduledTasks();
  }
}

beforeEach(() => {
  resetClock();
  resetScheduler();
  resetCoroutines();
  clearAll();
  clearHandlerBudget();
  clearScriptErrors();
});

describe('running a sequence', () => {
  it('runs up to the first yield immediately, then on the tick asked for', () => {
    const steps: string[] = [];

    startCoroutine('cutscene.js', function* () {
      steps.push('open');
      yield wait(3);
      steps.push('middle');
      yield wait(1);
      steps.push('end');
    });

    // The opening lands on the frame that started it, not a tick later.
    expect(steps).toEqual(['open']);

    tick(2);
    expect(steps).toEqual(['open']);
    tick();
    expect(steps).toEqual(['open', 'middle']);
    tick();
    expect(steps).toEqual(['open', 'middle', 'end']);
  });

  it('reports done once the generator returns, and frees the queue', () => {
    const handle = startCoroutine('cutscene.js', function* () {
      yield wait(1);
    });

    expect(handle.done).toBe(false);
    expect(activeCoroutineCount()).toBe(1);

    tick();

    expect(handle.done).toBe(true);
    expect(activeCoroutineCount()).toBe(0);
    expect(scheduledTaskCount()).toBe(0);
  });

  it('resumes on the next tick for wait(0)', () => {
    const steps: string[] = [];
    startCoroutine('s.js', function* () {
      yield wait(0);
      steps.push('resumed');
    });

    expect(steps).toEqual([]);
    tick();
    expect(steps).toEqual(['resumed']);
  });

  it('runs a loop once per tick without stacking up work', () => {
    let rounds = 0;
    startCoroutine('s.js', function* () {
      while (rounds < 3) {
        rounds++;
        yield wait(1);
      }
    });

    expect(rounds).toBe(1);
    tick();
    expect(rounds).toBe(2);
    tick(5);
    expect(rounds).toBe(3);
  });
});

describe('waiting on an event', () => {
  it('hands the payload back as the value of the yield', () => {
    let seen: unknown;

    startCoroutine('s.js', function* () {
      seen = yield waitFor('playerLevelUp');
    });

    expect(seen).toBeUndefined();
    emit('playerLevelUp', { player: { name: 'Alice' } as never, level: 2 });
    expect(seen).toMatchObject({ level: 2 });
  });

  // Without this, "wait for THIS npc" is a re-yield loop in every script.
  it('stays asleep while the predicate says no', () => {
    const steps: string[] = [];

    startCoroutine('s.js', function* () {
      yield waitFor(
        'playerLevelUp',
        (p) => (p as { level: number }).level >= 10,
      );
      steps.push('woke');
    });

    emit('playerLevelUp', { player: {} as never, level: 3 });
    expect(steps).toEqual([]);

    emit('playerLevelUp', { player: {} as never, level: 10 });
    expect(steps).toEqual(['woke']);
  });

  // A coroutine parked on a hook must not still be listening once it moves on,
  // or the next event resumes a generator that asked for something else.
  it('stops listening once it has moved past the wait', () => {
    let woke = 0;

    startCoroutine('s.js', function* () {
      yield waitFor('playerLevelUp');
      woke++;
      yield wait(100);
    });

    emit('playerLevelUp', { player: {} as never, level: 2 });
    emit('playerLevelUp', { player: {} as never, level: 3 });
    emit('playerLevelUp', { player: {} as never, level: 4 });

    expect(woke).toBe(1);
  });

  // A loop over the same event is how "every time X happens" is written.
  // Resuming re-subscribes, and a Set visits entries added while iterating,
  // so without the copy in hooks.emit one emit would walk the whole loop.
  it('wakes once per event when the sequence loops on the same one', () => {
    let woke = 0;

    startCoroutine('loop.js', function* () {
      for (let i = 0; i < 5; i++) {
        yield waitFor('playerLevelUp');
        woke++;
      }
    });

    emit('playerLevelUp', { player: {} as never, level: 1 });
    expect(woke).toBe(1);

    emit('playerLevelUp', { player: {} as never, level: 2 });
    expect(woke).toBe(2);
  });

  it('mixes waits and events in one sequence', () => {
    const steps: string[] = [];

    startCoroutine('s.js', function* () {
      steps.push('armed');
      yield wait(2);
      steps.push('ready');
      yield waitFor('playerDeath');
      steps.push('done');
    });

    tick(2);
    expect(steps).toEqual(['armed', 'ready']);
    emit('playerDeath', { player: {} as never });
    expect(steps).toEqual(['armed', 'ready', 'done']);
  });
});

describe('cancellation', () => {
  // The ghost the reload has to prevent: the handle is what the sandbox
  // cleanup calls, so a cancelled coroutine must let go of both kinds of wait.
  it('cancel stops a timed sequence and drops its scheduled task', () => {
    const steps: string[] = [];
    const handle = startCoroutine('s.js', function* () {
      yield wait(1);
      steps.push('should not run');
    });

    expect(scheduledTaskCount()).toBe(1);
    handle.cancel();
    expect(scheduledTaskCount()).toBe(0);
    expect(handle.done).toBe(true);

    tick(5);
    expect(steps).toEqual([]);
    expect(activeCoroutineCount()).toBe(0);
  });

  it('cancel unsubscribes a sequence parked on an event', () => {
    const steps: string[] = [];
    const handle = startCoroutine('s.js', function* () {
      yield waitFor('playerDeath');
      steps.push('should not run');
    });

    handle.cancel();
    emit('playerDeath', { player: {} as never });

    expect(steps).toEqual([]);
  });

  // What a sequence took, it has to give back. `return()` on the generator is
  // what runs the script's own finally block, so a reload mid-cutscene does
  // not leave the player frozen forever.
  it('runs the generator finally block, so the sequence can release things', () => {
    let released = false;

    const handle = startCoroutine('s.js', function* () {
      try {
        yield wait(10);
      } finally {
        released = true;
      }
    });

    handle.cancel();
    expect(released).toBe(true);
  });

  it('is safe to cancel twice', () => {
    const handle = startCoroutine('s.js', function* () {
      yield wait(1);
    });

    handle.cancel();
    expect(() => handle.cancel()).not.toThrow();
    expect(activeCoroutineCount()).toBe(0);
  });
});

describe('failures', () => {
  it('ends the coroutine when the generator throws, and names the script', () => {
    const handle = startCoroutine('boom.js', function* boom() {
      yield wait(1);
      throw new Error('exploded');
    });

    tick();

    expect(handle.done).toBe(true);
    expect(activeCoroutineCount()).toBe(0);
    const errors = getScriptErrors();
    expect(errors[0]).toMatchObject({
      script: 'boom.js',
      source: 'coroutine',
      context: 'coroutine:boom',
    });
  });

  // A yielded value that is not an instruction would otherwise park the
  // coroutine on nothing at all, which looks exactly like a hang.
  it('refuses a yield that is not wait() or waitFor()', () => {
    let released = false;
    const handle = startCoroutine('s.js', function* () {
      try {
        yield 42;
      } finally {
        released = true;
      }
    });

    expect(handle.done).toBe(true);
    expect(released).toBe(true);
    expect(getScriptErrors()[0]).toMatchObject({ source: 'coroutine' });
  });

  it('refuses a plain function instead of a generator', () => {
    const handle = startCoroutine('s.js', (() => {}) as never);

    expect(handle.done).toBe(true);
    expect(getScriptErrors()[0]).toMatchObject({ source: 'coroutine' });
  });

  it('does not let a throwing sequence stop the tick', () => {
    startCoroutine('boom.js', function* () {
      yield wait(1);
      throw new Error('exploded');
    });

    expect(() => tick()).not.toThrow();
  });
});

describe('the time a resume costs', () => {
  // A resume is a fresh entry into sandboxed code, and one that skipped the
  // funnel would be script time the per-script accounting cannot see.
  it('charges every resume to the script that owns it', () => {
    startCoroutine('slow.js', function* named() {
      yield wait(1);
      yield wait(1);
    });

    tick(2);

    const cost = handlerCosts().find(
      (entry) =>
        entry.script === 'slow.js' && entry.handler === 'coroutine:named',
    );
    // Start plus two resumes.
    expect(cost?.calls).toBe(3);
  });

  it('names the generator, so the log points at the sequence not just the file', () => {
    startCoroutine('s.js', function* openGate() {
      yield wait(1);
    });

    expect(handlerCosts().some((c) => c.handler === 'coroutine:openGate')).toBe(
      true,
    );
  });

  // A disabled handler is never run again, so a coroutine left parked would sit
  // on its subscription forever waiting for a resume that cannot come.
  it('ends a coroutine whose handler the budget switched off', () => {
    const overBudget = config.scripting.handlerBudgetMs + 1;
    const strikes = config.scripting.handlerBudgetStrikes;

    const handle = startCoroutine('hog.js', function* hog() {
      for (;;) {
        const until = performance.now() + overBudget;
        while (performance.now() < until) {
          /* burn past the budget */
        }
        yield wait(1);
      }
    });

    // One strike per resume; the run after the last one is refused.
    tick(strikes + 1);

    expect(isHandlerDisabled('hog.js', 'coroutine:hog')).toBe(true);
    expect(handle.done).toBe(true);
    expect(activeCoroutineCount()).toBe(0);
    expect(scheduledTaskCount()).toBe(0);
  });

  it('runs the finally blocks of a coroutine the budget switched off', () => {
    const overBudget = config.scripting.handlerBudgetMs + 1;
    let frozen = false;

    startCoroutine('hog.js', function* hog() {
      frozen = true;
      try {
        for (;;) {
          const until = performance.now() + overBudget;
          while (performance.now() < until) {
            /* burn past the budget */
          }
          yield wait(1);
        }
      } finally {
        frozen = false;
      }
    });
    tick(config.scripting.handlerBudgetStrikes + 1);

    expect(frozen).toBe(false);
  });
});

/**
 * Through the real sandbox: a coroutine still parked when its file reloads
 * is a ghost, holding the old code and acting on the new world.
 */
describe('a script reload takes its coroutines with it', () => {
  it('cancels a coroutine still waiting on a tick', () => {
    const handle = runInSandbox(
      `
      globalThis.__ran = false;
      coroutine(function* () {
        yield wait(2);
        globalThis.__ran = true;
      });
      `,
      'ghost.js',
    );

    expect(activeCoroutineCount()).toBe(1);
    handle.cleanup();
    expect(activeCoroutineCount()).toBe(0);
    expect(scheduledTaskCount()).toBe(0);

    tick(5); // the reloaded file's turn; the old sequence must not speak
  });

  it('cancels a coroutine still parked on an event', () => {
    const handle = runInSandbox(
      `
      coroutine(function* () {
        yield waitFor('playerDeath');
        error('the ghost woke up');
      });
      `,
      'ghost.js',
    );

    handle.cleanup();
    emit('playerDeath', { player: {} as never });

    expect(getScriptErrors('ghost.js')).toEqual([]);
    expect(activeCoroutineCount()).toBe(0);
  });

  it('a sequence started from a hook dies with the script too', () => {
    const handle = runInSandbox(
      `
      on('playerLevelUp', () => {
        coroutine(function* () { yield wait(5); });
      });
      `,
      'late.js',
    );

    emit('playerLevelUp', { player: {} as never, level: 2 });
    expect(activeCoroutineCount()).toBe(1);

    handle.cleanup();
    expect(activeCoroutineCount()).toBe(0);
  });

  // A script that starts a sequence per event never reloads in between.
  it('holds nothing for the reload past a sequence that ended or a task that fired', () => {
    const cleanups: (() => void)[] = [];
    const api = buildApi(
      'busy.js',
      (fn) => cleanups.push(fn),
      () => {},
    );
    const registered = cleanups.length;

    for (let i = 0; i < 3; i++) {
      api.coroutine(function* () {
        yield wait(1);
      });
      api.after(1, () => {});
    }
    tick(2);

    expect(cleanups.length).toBe(registered);
  });

  it('runs the sequence written the way a script would write it', () => {
    const handle = runInSandbox(
      `
      globalThis.__steps = [];
      coroutine(function* cutscene() {
        __steps.push('open');
        yield wait(1);
        const payload = yield waitFor('playerLevelUp', (p) => p.level >= 5);
        __steps.push('level ' + payload.level);
      });
      `,
      'cutscene.js',
    );

    tick();
    emit('playerLevelUp', { player: {} as never, level: 2 });
    emit('playerLevelUp', { player: {} as never, level: 7 });

    expect(handle).toBeTruthy();
    expect(getScriptErrors('cutscene.js')).toEqual([]);
    expect(activeCoroutineCount()).toBe(0); // it finished, not leaked

    handle.cleanup();
  });
});

describe('several at once', () => {
  it('keeps sequences independent', () => {
    const a: string[] = [];
    const b: string[] = [];

    startCoroutine('a.js', function* () {
      yield wait(1);
      a.push('a1');
      yield wait(2);
      a.push('a2');
    });
    startCoroutine('b.js', function* () {
      yield wait(2);
      b.push('b1');
    });

    tick();
    expect(a).toEqual(['a1']);
    expect(b).toEqual([]);

    tick();
    expect(b).toEqual(['b1']);
    expect(a).toEqual(['a1']);

    tick();
    expect(a).toEqual(['a1', 'a2']);
  });

  it('cancelling one leaves the others running', () => {
    const kept: string[] = [];

    const doomed = startCoroutine('a.js', function* () {
      yield wait(1);
      kept.push('doomed');
    });
    startCoroutine('b.js', function* () {
      yield wait(1);
      kept.push('kept');
    });

    doomed.cancel();
    tick();

    expect(kept).toEqual(['kept']);
    expect(activeCoroutineCount()).toBe(0);
  });
});
