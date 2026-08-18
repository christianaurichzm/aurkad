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
 *
 * The account's address lives here too: the same token and lifetime
 * asking "does this address answer?" instead of "may this person set a
 * password?", and an address is only worth storing as the place reset
 * links go to.
 */

const SALT_ROUNDS = 10;

/** Short: the link is a bearer secret, and it travels by mail. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export type ChangeResult = 'ok' | 'no-account' | 'wrong-password';
export type ResetResult = 'ok' | 'invalid-token';

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

async function mintToken(username: string, email?: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await PasswordResetModel.create({
    username,
    tokenHash: hashToken(token),
    expiresAt,
    ...(email ? { email } : {}),
  });
  return { token, expiresAt };
}

/**
 * The row a token names, or nothing if it is spent, unknown or out of date.
 *
 * The date is checked here rather than left to the TTL sweeper, which runs on
 * its own schedule and can be a minute behind.
 */
async function liveToken(token: string) {
  const row = await PasswordResetModel.findOne({
    tokenHash: hashToken(token),
  }).exec();
  return row && row.expiresAt.getTime() > Date.now() ? row : null;
}

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
export async function createResetToken(username: string): Promise<{
  token: string;
  username: string;
  email?: string;
  expiresAt: Date;
} | null> {
  const record = await getPlayerByNameFromDb(username);
  if (!record) return null;

  const token = await mintToken(record.name);
  return { ...token, username: record.name, email: record.email };
}

/**
 * Mints a link that proves an address answers. The address rides on the
 * token and is copied to the account when the link comes back: one stored
 * before it answers is a typo that mails the next reset link, and so the
 * account, to a stranger.
 */
export async function createEmailToken(
  username: string,
  email: string,
): Promise<{ token: string; expiresAt: Date }> {
  return mintToken(username, email);
}

/**
 * Spends an address token, which is the moment the address becomes real.
 *
 * A reset token cannot be spent here and an address token cannot set a
 * password: both are checked by the presence of the address on the row, so one
 * kind of link is never the other kind of permission.
 */
export async function confirmEmailToken(token: string): Promise<ResetResult> {
  const row = await liveToken(token);
  if (!row?.email) return 'invalid-token';

  await PlayerModel.updateOne(
    { name: row.username },
    { email: row.email },
  ).exec();
  await PasswordResetModel.deleteOne({ _id: row._id }).exec();
  return 'ok';
}

/** Spends a token. One use, and only while it is still in date. */
export async function consumeResetToken(
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  const row = await liveToken(token);
  if (!row || row.email) return 'invalid-token';

  await writePassword(row.username, newPassword);
  return 'ok';
}

/** Where a token is spent. The client reads it off the query string. */
export function resetLink(token: string): string {
  return `${config.mail.publicBaseUrl}/?reset=${encodeURIComponent(token)}`;
}

/**
 * Where an address token is spent: a server route, not a screen. The token
 * is the whole proof, so there is nothing to fill in, and a mail scanner
 * fetching the link first only confirms the address, which is what the
 * link is for. A reset link cannot be spent that way, so it is a screen.
 */
export function emailConfirmLink(token: string): string {
  return `${config.mail.publicBaseUrl}/email/confirm?token=${encodeURIComponent(token)}`;
}
