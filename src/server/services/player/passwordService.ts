import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { config } from '../../config.js';
import PasswordResetModel from '../../model/PasswordReset.js';
import PlayerModel from '../../model/Player.js';
import { getPlayerByNameFromDb } from './playerService.js';

/**
 * Passwords: setting one, and proving you may without knowing the current
 * one. A reset token is a bearer secret with a short life, minted for an
 * account and spent once; delivering it belongs to comms/mailService.ts.
 */

const SALT_ROUNDS = 10;

/** Short: the link is a bearer secret, and it travels by mail. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export type ChangeResult = 'ok' | 'no-account' | 'wrong-password';
export type ResetResult = 'ok' | 'invalid-token';

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

async function writePassword(username: string, password: string) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  await PlayerModel.updateOne({ name: username }, { password: hash }).exec();
  // Every link minted before this moment is a way back into an account whose
  // owner just moved it, so all of them die with the change, including the
  // one being spent.
  await PasswordResetModel.deleteMany({ username }).exec();
}

/** The path for someone who is logged in and knows their current password. */
export async function changePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangeResult> {
  const record = await getPlayerByNameFromDb(username);
  if (!record) return 'no-account';
  if (!(await bcrypt.compare(currentPassword, record.password))) {
    return 'wrong-password';
  }
  await writePassword(record.name, newPassword);
  return 'ok';
}

/**
 * Mints a link for an account, or nothing if there is no such account. The
 * caller decides what "nothing" looks like: a public endpoint must answer
 * the same either way, or it reveals which usernames exist.
 */
export async function createResetToken(
  username: string,
): Promise<{ token: string; username: string; expiresAt: Date } | null> {
  const record = await getPlayerByNameFromDb(username);
  if (!record) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await PasswordResetModel.create({
    username: record.name,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return { token, username: record.name, expiresAt };
}

/** Spends a token. One use, and only while it is still in date. */
export async function consumeResetToken(
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  const row = await PasswordResetModel.findOne({
    tokenHash: hashToken(token),
  }).exec();
  // The date is checked here rather than left to the TTL sweeper, which runs
  // on its own schedule and can be a minute behind.
  if (!row || row.expiresAt.getTime() <= Date.now()) return 'invalid-token';

  await writePassword(row.username, newPassword);
  return 'ok';
}

/** Where a token is spent. The client reads it off the query string. */
export function resetLink(token: string): string {
  return `${config.mail.publicBaseUrl}/?reset=${encodeURIComponent(token)}`;
}
