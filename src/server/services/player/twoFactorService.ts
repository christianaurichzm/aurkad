import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { config } from '../../config.js';
import TwoFactorModel from '../../model/TwoFactor.js';

/**
 * The second factor for an operator account: TOTP (RFC 6238), plus printed
 * codes that get somebody back in when the phone is gone. Written out, as
 * it is one HMAC and a truncation the RFC spells out, with published test
 * vectors and no protocol to keep up with.
 *
 * The secret is stored as the app reads it, base32 in the clear, so a dump
 * of this collection can generate codes. It does not get anyone in, as the
 * password is bcrypt elsewhere; encrypting under SESSION_SECRET would lock
 * every operator out on a routine rotation. Recovery codes are hashed,
 * since one alone completes a login.
 */

const SALT_ROUNDS = 10;
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Steps either side of the current one that pass, for drifting clocks. */
const SKEW_STEPS = 1;
const RECOVERY_CODES = 10;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Bytes are Uint8Array rather than Buffer throughout: node:crypto's types
// refuse a Buffer where they ask for BinaryLike, and Buffer is a
// Uint8Array at runtime either way.
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Null for anything that is not base32, which is how a typo comes back. */
function base32Decode(text: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/[\s=]/g, '')) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/**
 * HOTP (RFC 4226): HMAC-SHA1 over the counter, then the spec's dynamic
 * truncation: the low nibble of the last byte picks four bytes, their top
 * bit is dropped, and the rest is read as a decimal of `DIGITS` places.
 */
function hotp(secret: Uint8Array, counter: number): string {
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const mac = crypto.createHmac('sha1', secret).update(message).digest();

  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The step a moment falls in, for the tests and the replay guard. */
export const stepAt = (atMs: number): number =>
  Math.floor(atMs / 1000 / STEP_SECONDS);

/** The code an app would be showing for this secret at this moment. */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const bytes = base32Decode(secret);
  if (!bytes) return '';
  return hotp(bytes, stepAt(atMs));
}

/** Same length or not equal: timingSafeEqual throws on a length mismatch. */
function sameCode(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * The step this code is good for, or null.
 *
 * `after` is the last step already spent on this account: a code is a bearer
 * secret for its whole half-minute, so one read off a screen share is good
 * until it expires unless the step it belongs to is refused a second time.
 */
export function verifyTotp(
  secret: string,
  token: string,
  atMs: number = Date.now(),
  after = 0,
): number | null {
  const code = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;

  const bytes = base32Decode(secret);
  if (!bytes) return null;

  const now = stepAt(atMs);
  for (let step = now - SKEW_STEPS; step <= now + SKEW_STEPS; step++) {
    if (step <= after) continue;
    if (sameCode(hotp(bytes, step), code)) return step;
  }
  return null;
}

/** A fresh 160-bit secret, which is what RFC 4226 asks for with SHA1. */
export const newSecret = (): string =>
  base32Encode(new Uint8Array(crypto.randomBytes(20)));

/**
 * What the authenticator app scans or is typed into it.
 *
 * The issuer is the address players use, because an operator who runs two
 * games needs two entries in the app that can be told apart, and that address
 * is the only name this engine knows for a deployment.
 */
export function otpauthUrl(username: string, secret: string): string {
  let issuer = 'Engine';
  try {
    issuer = new URL(config.mail.publicBaseUrl).host || issuer;
  } catch {
    // Leaves the fallback: a label is not worth failing an enrollment over.
  }
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Printed once, never shown again: a group is easier to read back aloud. */
function newRecoveryCode(): string {
  const raw = base32Encode(new Uint8Array(crypto.randomBytes(7))).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export type EnableResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: 'wrong-code' | 'already-enabled' };

/**
 * Turns the factor on, but only for someone who can already produce a code:
 * enrolling from a secret nobody scanned successfully is how an account locks
 * itself out on the next login.
 *
 * Never over a factor that is on. Replacing one would let a session and a
 * password swap the authenticator without the code that turning it off asks
 * for; the way to a new one is off, then on.
 */
export async function enableTwoFactor(
  username: string,
  secret: string,
  token: string,
): Promise<EnableResult> {
  const step = verifyTotp(secret, token);
  if (step === null) return { ok: false, reason: 'wrong-code' };

  const recoveryCodes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  const recovery = await Promise.all(
    recoveryCodes.map((code) => bcrypt.hash(code, SALT_ROUNDS)),
  );

  // Inserted or nothing, in one operation: two enrollments racing each other
  // cannot both land.
  const written = await TwoFactorModel.updateOne(
    { username },
    {
      $setOnInsert: {
        username,
        secret,
        enabledAt: new Date(),
        // The code just spent counts as spent: enrolling and logging in are
        // seconds apart, and the same code must not do both.
        lastStep: step,
        recovery,
      },
    },
    { upsert: true },
  ).exec();
  if (written.upsertedCount === 0) {
    return { ok: false, reason: 'already-enabled' };
  }

  return { ok: true, recoveryCodes };
}

/** Off, and the secret goes with it; re-enrolling mints a new one. */
export async function disableTwoFactor(username: string): Promise<boolean> {
  const result = await TwoFactorModel.deleteOne({ username }).exec();
  return result.deletedCount > 0;
}

export interface TwoFactorStatus {
  enabled: boolean;
  /** How many printed codes are still unspent, for the panel to warn on. */
  recoveryLeft: number;
}

export async function twoFactorStatus(
  username: string,
): Promise<TwoFactorStatus> {
  const row = await TwoFactorModel.findOne({ username }).lean().exec();
  return {
    enabled: !!row,
    recoveryLeft: row?.recovery.length ?? 0,
  };
}

export type SecondFactorResult = 'ok' | 'required' | 'wrong';

/**
 * The check every path that mints a session runs after the password.
 *
 * "No enrollment" answers `ok`: this is a self-hosted game whose first account
 * is an admin, and a factor nobody set up cannot be a reason nobody can log in.
 *
 * A recovery code is tried only when the input is not shaped like a TOTP code.
 * Ten bcrypt comparisons is the cost of the recovery path, and a six-digit
 * guess has no business paying it.
 */
export async function checkSecondFactor(
  username: string,
  token: string | undefined,
): Promise<SecondFactorResult> {
  const row = await TwoFactorModel.findOne({ username }).exec();
  if (!row) return 'ok';
  if (!token) return 'required';

  const step = verifyTotp(row.secret, token, Date.now(), row.lastStep ?? 0);
  if (step !== null) {
    // The step the read accepted is also the condition the write is made
    // under, and only the login that moves it is let in. Deciding on the read
    // alone would let a code pass as many times as it is offered at once,
    // which is the shoulder-surfing the step exists to stop, minus the wait.
    const spent = await TwoFactorModel.updateOne(
      { username, lastStep: { $lt: step } },
      { $set: { lastStep: step } },
    ).exec();
    return spent.modifiedCount > 0 ? 'ok' : 'wrong';
  }

  if (/^\d{6}$/.test(token.replace(/\s/g, ''))) return 'wrong';

  const offered = token.trim().toUpperCase();
  for (const hash of row.recovery) {
    if (await bcrypt.compare(offered, hash)) {
      // Spent, not merely counted: the printed sheet is a list of one-use
      // passwords, and a used one left behind is a password with no expiry.
      // The code is a condition of the write and not only its subject, because
      // `$pull` of something already pulled reports the same quiet success.
      const spent = await TwoFactorModel.updateOne(
        { username, recovery: hash },
        { $pull: { recovery: hash } },
      ).exec();
      return spent.modifiedCount > 0 ? 'ok' : 'wrong';
    }
  }
  return 'wrong';
}
