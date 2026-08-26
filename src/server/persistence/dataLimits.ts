// Size limits on the free-form data scripts persist. MongoDB rejects any
// document over 16MB, and for player data that is unrecoverable: the save
// fails, dirtyPlayers re-queues it, the retry fails, and the character
// stops persisting until an operator edits the document by hand. One line
// of script gets there:
//
//     on('tick', ({ tick }) => {
//       const log = getPlayerData(player, 'log') ?? [];
//       log.push(tick);                  // grows forever
//       setPlayerData(player, 'log', log);
//     });
//
// So the write is refused at the boundary. A cap per value times a cap on
// key count is a hard ceiling that costs only serializing the value being
// written, with no per-key size table to keep in step.

import { config } from '../config.js';

export type DataLimitFailure =
  'not-serializable' | 'value-too-large' | 'too-many-keys';

export type DataLimitResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: DataLimitFailure; bytes?: number };

/**
 * Serialized size of a value, or why it cannot be stored.
 *
 * Uses the same JSON encoding the database will, so the number is the one that
 * actually counts. A circular reference or a function makes it unstorable, and
 * catching that here turns a write that would have thrown deep inside the
 * driver into a refusal the script can see.
 */
export function measureValue(value: unknown): DataLimitResult {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    // Circular structures land here.
    return { ok: false, reason: 'not-serializable' };
  }
  // undefined, a function or a symbol encodes to nothing at all.
  if (encoded === undefined) return { ok: false, reason: 'not-serializable' };

  const bytes = Buffer.byteLength(encoded, 'utf8');
  if (bytes > config.scriptData.maxValueBytes) {
    return { ok: false, reason: 'value-too-large', bytes };
  }
  return { ok: true, bytes };
}

/**
 * Whether `key` may be written into `data`. Overwriting an existing key is
 * always allowed, or a script at the cap could not shrink or clear a value,
 * the one thing it needs to recover.
 */
export function checkDataWrite(
  data: Record<string, unknown> | undefined,
  key: string,
  value: unknown,
): DataLimitResult {
  const measured = measureValue(value);
  if (!measured.ok) return measured;

  const isNewKey = !data || !Object.prototype.hasOwnProperty.call(data, key);
  if (
    isNewKey &&
    data &&
    Object.keys(data).length >= config.scriptData.maxKeys
  ) {
    return { ok: false, reason: 'too-many-keys' };
  }
  return measured;
}

/** Human-readable reason, for the log line a script author actually reads. */
export function explainLimit(result: {
  reason: DataLimitFailure;
  bytes?: number;
}): string {
  switch (result.reason) {
    case 'not-serializable':
      return 'value is not JSON-serializable (circular reference, function or undefined)';
    case 'value-too-large':
      return `value is ${result.bytes} bytes, over the ${config.scriptData.maxValueBytes} byte limit`;
    case 'too-many-keys':
      return `already at the ${config.scriptData.maxKeys} key limit`;
  }
}

/**
 * A detached copy of a stored value, for handing to script code. A read
 * returning the live object would let read-modify-write change storage
 * before the write check runs; copying here makes the write the only way
 * in. Primitives are returned as they are.
 */
export function copyStoredValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}
