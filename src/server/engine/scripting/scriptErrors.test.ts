import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordScriptError,
  getScriptErrors,
  clearScriptErrors,
  locateInScript,
} from './scriptErrors.js';

function errorWithStack(message: string, stack: string): Error {
  const err = new Error(message);
  err.stack = stack;
  return err;
}

beforeEach(() => {
  clearScriptErrors();
});

describe('locateInScript', () => {
  it('pulls line and column out of a normal stack frame', () => {
    const stack = [
      'TypeError: x is not a function',
      '    at quest.js:12:7',
      '    at wrapped (/app/src/server/engine/scripting/api.ts:131:9)',
    ].join('\n');

    expect(locateInScript(stack, 'quest.js')).toEqual({ line: 12, column: 7 });
  });

  it('handles the named-function frame form', () => {
    const stack = ['Error: boom', '    at onPlayerJoin (quest.js:4:15)'].join(
      '\n',
    );

    expect(locateInScript(stack, 'quest.js')).toEqual({ line: 4, column: 15 });
  });

  // The line the script author can edit is the one that matters, and it is not
  // the top frame when the throw came out of an engine helper.
  it('skips engine frames and returns the first frame inside the script', () => {
    const stack = [
      'Error: Item 999 not found',
      '    at getItemById (/app/src/server/services/economy/inventoryService.ts:44:11)',
      '    at giveItem (/app/src/server/engine/scripting/api.ts:300:5)',
      '    at quest.js:20:3',
    ].join('\n');

    expect(locateInScript(stack, 'quest.js')).toEqual({ line: 20, column: 3 });
  });

  // A syntax error from vm.Script has no frames: its position is in the
  // header line alone.
  it('reads the position from a syntax error header', () => {
    const stack = [
      'quest.js:7',
      '  if (player {',
      '             ^',
      '',
      'SyntaxError: Unexpected token',
    ].join('\n');

    expect(locateInScript(stack, 'quest.js')).toEqual({ line: 7 });
  });

  it('returns nothing when no frame belongs to the script', () => {
    const stack = [
      'Error: boom',
      '    at /app/src/server/engine/hooks.ts:74:22',
    ].join('\n');

    expect(locateInScript(stack, 'quest.js')).toBeUndefined();
  });

  it('returns nothing without a stack', () => {
    expect(locateInScript(undefined, 'quest.js')).toBeUndefined();
  });
});

describe('recordScriptError', () => {
  it('records the script, message, position and context', () => {
    recordScriptError(
      'quest.js',
      errorWithStack('nope', 'Error: nope\n    at quest.js:3:5'),
      'hook',
      'playerJoin',
    );

    const [error] = getScriptErrors();
    expect(error).toMatchObject({
      script: 'quest.js',
      message: 'Error: nope',
      line: 3,
      column: 5,
      source: 'hook',
      context: 'playerJoin',
      count: 1,
    });
  });

  it('accepts a thrown non-Error', () => {
    recordScriptError('quest.js', 'just a string', 'hook', 'tick');

    expect(getScriptErrors()[0]).toMatchObject({
      message: 'just a string',
      line: undefined,
    });
  });

  // A handler that throws on `tick` fails 20 times a second; without collapsing
  // it would evict every other script's errors within a second.
  it('collapses repeats of the same failure into a count', () => {
    const err = errorWithStack('boom', 'Error: boom\n    at quest.js:3:5');
    for (let i = 0; i < 40; i++) {
      recordScriptError('quest.js', err, 'hook', 'tick');
    }

    const all = getScriptErrors();
    expect(all).toHaveLength(1);
    expect(all[0]!.count).toBe(40);
  });

  it('keeps failures on different lines apart', () => {
    recordScriptError(
      'quest.js',
      errorWithStack('a', 'Error: a\n    at quest.js:3:5'),
      'hook',
      'tick',
    );
    recordScriptError(
      'quest.js',
      errorWithStack('a', 'Error: a\n    at quest.js:9:5'),
      'hook',
      'tick',
    );

    expect(getScriptErrors()).toHaveLength(2);
  });

  it('keeps the same failure from different hooks apart', () => {
    const err = errorWithStack('boom', 'Error: boom\n    at quest.js:3:5');
    recordScriptError('quest.js', err, 'hook', 'playerJoin');
    recordScriptError('quest.js', err, 'hook', 'playerLeave');

    expect(getScriptErrors()).toHaveLength(2);
  });

  it('evicts the oldest once the cap is reached instead of growing forever', () => {
    for (let i = 0; i < 80; i++) {
      recordScriptError(
        'quest.js',
        errorWithStack(`boom ${i}`, `Error: boom ${i}\n    at quest.js:${i}:1`),
        'hook',
        'tick',
      );
    }

    const all = getScriptErrors();
    expect(all).toHaveLength(50);
    expect(all.some((e) => e.message.includes('boom 79'))).toBe(true);
    expect(all.some((e) => e.message.includes('boom 0'))).toBe(false);
  });

  it('returns the newest first', async () => {
    recordScriptError('a.js', new Error('older'), 'load');
    await new Promise((r) => setTimeout(r, 2));
    recordScriptError('b.js', new Error('newer'), 'load');

    expect(getScriptErrors().map((e) => e.script)).toEqual(['b.js', 'a.js']);
  });
});

describe('clearScriptErrors', () => {
  beforeEach(() => {
    recordScriptError('a.js', new Error('one'), 'load');
    recordScriptError('b.js', new Error('two'), 'load');
  });

  it('clears a single script, which is what a reload does', () => {
    clearScriptErrors('a.js');

    expect(getScriptErrors().map((e) => e.script)).toEqual(['b.js']);
  });

  it('clears everything when given no name', () => {
    clearScriptErrors();

    expect(getScriptErrors()).toEqual([]);
  });
});

describe('getScriptErrors', () => {
  it('filters to one script', () => {
    recordScriptError('a.js', new Error('one'), 'load');
    recordScriptError('b.js', new Error('two'), 'load');

    expect(getScriptErrors('a.js')).toHaveLength(1);
    expect(getScriptErrors('a.js')[0]!.script).toBe('a.js');
  });
});
