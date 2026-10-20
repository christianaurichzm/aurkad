import { describe, it, expect, afterEach, vi } from 'vitest';
import { logger } from './logger.js';
import { reqCtx } from './context.js';

function captureStderr(fn: () => void): string {
  let written = '';
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      written += String(chunk);
      return true;
    });
  fn();
  spy.mockRestore();
  return written;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('error serialization', () => {
  // JSON.stringify renders an Error as {} because its fields are
  // non-enumerable, which would empty every logged stack.
  it('writes the message and stack of a logged error', () => {
    const err = new Error('database exploded');
    const line = captureStderr(() => logger.error('op failed', { err }));

    expect(line).toContain('database exploded');
    expect(line).toContain('Error');
    expect(line).toContain('stack');
    expect(line).not.toContain('"err":{}');
  });

  it('keeps the error name', () => {
    const line = captureStderr(() =>
      logger.error('op failed', { err: new TypeError('not a function') }),
    );

    expect(line).toContain('TypeError');
  });

  // Script errors are built by the vm realm's Error constructor, so they fail
  // `instanceof Error` in the host and the check has to go by shape.
  it('serializes an error-shaped object from another realm', () => {
    const foreign = {
      name: 'RangeError',
      message: 'out of bounds',
      stack: 'RangeError: out of bounds\n    at quest.js:4:2',
    };
    const line = captureStderr(() =>
      logger.error('script failed', { err: foreign }),
    );

    expect(line).toContain('out of bounds');
    expect(line).toContain('quest.js:4:2');
  });

  it('leaves ordinary context values alone', () => {
    const line = captureStderr(() =>
      logger.error('nope', { player: 'Alice', attempts: 3, tags: ['a', 'b'] }),
    );

    expect(line).toContain('"player":"Alice"');
    expect(line).toContain('"attempts":3');
    expect(line).toContain('["a","b"]');
  });

  it('does not mistake a plain object for an error', () => {
    const line = captureStderr(() =>
      logger.error('nope', { payload: { message: 'hi', other: 1 } }),
    );

    // `message` alone is not enough; without a stack it stays as written.
    expect(line).toContain('"other":1');
  });
});

// What ties a line to whoever caused it: HTTP fills this per request, and the
// tick fills it per client action (`processActions`). Without it an error from
// inside a hook names the failure and nothing else.
describe('request context', () => {
  it('stamps the id and the player on lines logged inside it', () => {
    const line = captureStderr(() =>
      reqCtx.run({ requestId: '4210.7', username: 'Alice' }, () =>
        logger.error('handler threw'),
      ),
    );

    expect(line).toContain('"requestId":"4210.7"');
    expect(line).toContain('"username":"Alice"');
  });

  it('survives the async continuation of the action that opened it', async () => {
    let written = '';
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written += String(chunk);
        return true;
      });

    await new Promise<void>((resolve) => {
      reqCtx.run({ requestId: '4211.0', username: 'Bob' }, () => {
        // The dispatch is synchronous but the handlers need not be: a persist
        // or a DB write logs its failure long after `run` returned, and that
        // line is the one an incident starts from.
        void Promise.resolve().then(() => {
          logger.error('late failure');
          resolve();
        });
      });
    });

    spy.mockRestore();
    expect(written).toContain('"requestId":"4211.0"');
    expect(written).toContain('"username":"Bob"');
  });

  it('leaves lines outside it alone', () => {
    const line = captureStderr(() => logger.error('no owner'));

    expect(line).not.toContain('requestId');
    expect(line).not.toContain('username');
  });
});

describe('errorThrottled', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the first error, holds repeats back, then reports how many', () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    vi.spyOn(logger, 'error').mockImplementation((msg, ctx) => {
      lines.push(`${msg} ${JSON.stringify(ctx ?? {})}`);
    });

    for (let i = 0; i < 20; i++) logger.errorThrottled('t1', 'failed');
    expect(lines).toEqual(['failed {}']);

    vi.advanceTimersByTime(5_000);
    logger.errorThrottled('t1', 'failed');
    expect(lines).toEqual(['failed {}', 'failed {"suppressed":19}']);
  });

  it('throttles each key on its own', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});

    logger.errorThrottled('t2', 'npc failed');
    logger.errorThrottled('t3', 'movement failed');

    expect(error).toHaveBeenCalledTimes(2);
  });
});
