/**
 * Bounds on script-persisted data.
 *
 * The failure being prevented is unrecoverable rather than merely slow: a
 * player document over MongoDB's 16MB limit fails to save, gets re-queued, and
 * fails again for the life of the server, so that character silently stops
 * persisting. These check the boundary refuses the write instead.
 */
import { describe, it, expect } from 'vitest';
import { checkDataWrite, explainLimit, measureValue } from './dataLimits.js';
import { config } from '../config.js';

const bigString = (bytes: number) => 'x'.repeat(bytes);

describe('measureValue', () => {
  it('reports the serialized size', () => {
    const result = measureValue({ a: 1 });
    expect(result).toEqual({ ok: true, bytes: 7 }); // {"a":1}
  });

  it('counts bytes, not characters', () => {
    // A 3-byte UTF-8 character must not be measured as one.
    const result = measureValue('日本語');
    expect(result.ok).toBe(true);
    expect(result.ok && result.bytes).toBe(11); // 9 bytes + 2 quotes
  });

  it('accepts a value just under the limit', () => {
    const result = measureValue(bigString(config.scriptData.maxValueBytes - 2));
    expect(result.ok).toBe(true);
  });

  it('refuses a value over the limit and says how big it was', () => {
    const result = measureValue(bigString(config.scriptData.maxValueBytes + 1));
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'value-too-large' });
    expect(!result.ok && result.bytes).toBeGreaterThan(
      config.scriptData.maxValueBytes,
    );
  });

  // A circular value would throw deep inside the driver on save; catching it
  // here turns that into something the script author can see.
  it('refuses a circular structure', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;

    expect(measureValue(circular)).toEqual({
      ok: false,
      reason: 'not-serializable',
    });
  });

  it('refuses values JSON drops entirely', () => {
    expect(measureValue(undefined)).toMatchObject({
      reason: 'not-serializable',
    });
    expect(measureValue(() => {})).toMatchObject({
      reason: 'not-serializable',
    });
  });

  it('accepts null, which is a real storable value', () => {
    expect(measureValue(null).ok).toBe(true);
  });
});

describe('checkDataWrite', () => {
  const atKeyLimit = () =>
    Object.fromEntries(
      Array.from({ length: config.scriptData.maxKeys }, (_, i) => [`k${i}`, 1]),
    );

  it('allows a new key while under the cap', () => {
    expect(checkDataWrite({ a: 1 }, 'b', 2).ok).toBe(true);
  });

  it('allows a write into empty data', () => {
    expect(checkDataWrite(undefined, 'a', 1).ok).toBe(true);
  });

  it('refuses a new key at the cap', () => {
    const result = checkDataWrite(atKeyLimit(), 'one-more', 1);
    expect(result).toEqual({ ok: false, reason: 'too-many-keys' });
  });

  // The recovery path: a script that filled the bag has to be able to shrink
  // or clear what is already there, so overwriting is never refused for count.
  it('still allows overwriting an existing key at the cap', () => {
    const data = atKeyLimit();
    expect(checkDataWrite(data, 'k0', 'replacement').ok).toBe(true);
  });

  it('refuses an oversized value even for an existing key', () => {
    const result = checkDataWrite(
      { a: 1 },
      'a',
      bigString(config.scriptData.maxValueBytes + 1),
    );
    expect(result).toMatchObject({ reason: 'value-too-large' });
  });

  // Object.keys ignores the prototype, but hasOwnProperty decides "new
  // key", and a key like "toString" exists on every object's prototype.
  it('treats an inherited property name as a new key', () => {
    const result = checkDataWrite({}, 'toString', 1);
    expect(result.ok).toBe(true);
  });

  it('refuses a circular value before looking at key count', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(checkDataWrite({}, 'a', circular)).toMatchObject({
      reason: 'not-serializable',
    });
  });
});

describe('explainLimit', () => {
  it('names the byte count and the limit for an oversized value', () => {
    const message = explainLimit({ reason: 'value-too-large', bytes: 99999 });
    expect(message).toContain('99999');
    expect(message).toContain(String(config.scriptData.maxValueBytes));
  });

  it('names the key limit', () => {
    expect(explainLimit({ reason: 'too-many-keys' })).toContain(
      String(config.scriptData.maxKeys),
    );
  });

  it('explains what unserializable means, not just that it is', () => {
    expect(explainLimit({ reason: 'not-serializable' })).toContain('circular');
  });
});
