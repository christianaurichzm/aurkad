import { describe, it, expect, afterEach, vi } from 'vitest';
import { logger } from './logger.js';

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
