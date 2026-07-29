/**
 * End to end: a script that breaks has to end up addressable by file and
 * line. The registry has its own tests; this checks the wiring, the part
 * that rots quietly: a wrapper that swallows before recording, or a stack
 * whose frames no longer name the script file.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runInSandbox } from './sandbox.js';
import { getScriptErrors, clearScriptErrors } from './scriptErrors.js';
import { clearAll, emit } from '../hooks.js';
import { createFixture } from '../../sim/simFixture.js';
import {
  resetScheduler,
  runScheduledTasks,
  scheduledTaskCount,
} from '../../sim/scheduler.js';
import { advanceTick } from '../../sim/clock.js';

beforeEach(() => {
  clearAll();
  clearScriptErrors();
  resetScheduler();
});

describe('a hook handler that throws', () => {
  it('is recorded against the script and the line that threw', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });

    // Line 3 of the source below is the `throw`.
    const handle = runInSandbox(
      [
        `on('playerJoin', () => {`,
        `  const x = null;`,
        `  x.nope();`,
        `});`,
      ].join('\n'),
      'broken-hook.js',
    );

    emit('playerJoin', { player });

    const errors = getScriptErrors('broken-hook.js');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      script: 'broken-hook.js',
      source: 'hook',
      context: 'playerJoin',
      line: 3,
    });
    expect(errors[0]!.message).toContain('TypeError');

    handle.cleanup();
  });

  it('still isolates the throw, so the game loop is unaffected', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `on('playerJoin', () => { throw new Error('boom'); });`,
      'noisy.js',
    );

    expect(() => emit('playerJoin', { player })).not.toThrow();
    expect(getScriptErrors('noisy.js')).toHaveLength(1);

    handle.cleanup();
  });

  it('collapses a handler that fails every tick into one entry', () => {
    const handle = runInSandbox(
      `on('tick', () => { throw new Error('every time'); });`,
      'hot.js',
    );

    for (let i = 0; i < 25; i++) emit('tick', { tick: i });

    const errors = getScriptErrors('hot.js');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.count).toBe(25);

    handle.cleanup();
  });
});

describe('a script that fails to load', () => {
  it('records a syntax error with its line', () => {
    const handle = runInSandbox(
      ['const a = 1;', 'function ( {', ''].join('\n'),
      'bad-syntax.js',
    );

    const errors = getScriptErrors('bad-syntax.js');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ source: 'load', line: 2 });
    expect(errors[0]!.message).toContain('SyntaxError');

    handle.cleanup();
  });

  it('records a throw at the top level of the file', () => {
    const handle = runInSandbox(
      ['log("starting");', 'throw new Error("cannot init");'].join('\n'),
      'bad-init.js',
    );

    expect(getScriptErrors('bad-init.js')[0]).toMatchObject({
      source: 'load',
      line: 2,
      message: 'Error: cannot init',
    });

    handle.cleanup();
  });
});

describe('a scheduled task that throws', () => {
  it('is recorded and does not stop the scheduler', () => {
    const handle = runInSandbox(
      [`every(1, () => {`, `  throw new Error('tick task broke');`, `});`].join(
        '\n',
      ),
      'bad-task.js',
    );

    advanceTick();
    runScheduledTasks();

    const errors = getScriptErrors('bad-task.js');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      source: 'schedule',
      context: 'every',
      line: 2,
    });
    // Re-armed rather than retired, so the failure keeps being visible.
    expect(scheduledTaskCount()).toBe(1);

    handle.cleanup();
  });
});

describe('reloading a script', () => {
  it('drops the previous version’s errors', () => {
    const broken = runInSandbox(
      `on('tick', () => { throw new Error('old bug'); });`,
      'fixme.js',
    );
    emit('tick', { tick: 1 });
    expect(getScriptErrors('fixme.js')).toHaveLength(1);
    broken.cleanup();

    // What loader.ts does before re-evaluating the file.
    clearScriptErrors('fixme.js');
    const fixed = runInSandbox(`on('tick', () => {});`, 'fixme.js');
    emit('tick', { tick: 2 });

    expect(getScriptErrors('fixme.js')).toEqual([]);

    fixed.cleanup();
  });

  it('keeps other scripts’ errors when one is reloaded', () => {
    const a = runInSandbox(
      `on('tick', () => { throw new Error('a'); });`,
      'a.js',
    );
    const b = runInSandbox(
      `on('tick', () => { throw new Error('b'); });`,
      'b.js',
    );
    emit('tick', { tick: 1 });

    clearScriptErrors('a.js');

    expect(getScriptErrors('a.js')).toEqual([]);
    expect(getScriptErrors('b.js')).toHaveLength(1);

    a.cleanup();
    b.cleanup();
  });
});
