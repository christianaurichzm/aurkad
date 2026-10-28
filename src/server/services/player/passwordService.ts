import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { config } from '../../config.js';
import PasswordResetModel from '../../model/PasswordReset.js';
import PlayerModel from '../../model/Player.js';
import {
  authEpochOf,
  getPlayerByNameFromDb,
  notifySessionRevoked,
} from './playerService.js';

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

async function mintToken(
  username: string,
  bound: { authEpoch: number; email?: string; sentTo?: string },
) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await PasswordResetModel.create({
    username,
    tokenHash: hashToken(token),
    expiresAt,
    ...bound,
  });
  return { token, expiresAt };
}

/**
 * The row a token names, spent in the same breath, or nothing if it was
 * already spent, is unknown, out of date, or is the other kind of link.
 *
 * Finding and removing are one write because they are one decision: two
 * requests that read the same row before either deletes it both hold a live
 * token, and a token that exists once has then been spent twice.
 *
 * The date is a condition of that write rather than a check afterwards, for
 * the same reason and because the TTL sweeper runs on Mongo's own schedule and
 * can be a minute behind.
 */
async function spendToken(token: string, withAddress: boolean) {
  return PasswordResetModel.findOneAndDelete({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
    email: { $exists: withAddress },
  }).exec();
}

// An account written before the generation existed has no field, and the
// session check reads that as 0.
const inEpoch = (authEpoch: number) => ({
  authEpoch: authEpoch === 0 ? { $in: [0, null] } : authEpoch,
});

/**
 * `proof` is what the caller's right to write was checked against: the
 * hash a change proved knowledge of, or the generation and address a reset
 * link was minted for. The write is conditional on it, because the hash is
 * slow enough for the other path to land in between, and whichever came
 * second would hand the account back to whoever the first locked out.
 */
async function writePassword(
  username: string,
  password: string,
  proof: { password: string } | { authEpoch: number; sentTo?: string },
): Promise<boolean> {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const guard =
    'authEpoch' in proof
      ? { ...inEpoch(proof.authEpoch), email: proof.sentTo ?? null }
      : proof;
  // One write, because a changed password with the earlier sessions still
  // alive is what an interruption must not leave behind: whoever is being
  // locked out is exactly who those sessions belong to.
  const account = await PlayerModel.findOneAndUpdate(
    { name: username, ...guard },
    { $set: { password: hash }, $inc: { authEpoch: 1 } },
    { returnDocument: 'after' },
  )
    .select({ authEpoch: 1 })
    .lean<{ authEpoch: number }>()
    .exec();
  if (!account) return false;
  notifySessionRevoked(username, account.authEpoch);
  // Every link minted before this moment is a way back into an account whose
  // owner just moved it, so all of them die with the change, including the
  // one being spent.
  await PasswordResetModel.deleteMany({ username }).exec();
  return true;
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
  return (await writePassword(record.name, newPassword, {
    password: record.password,
  }))
    ? 'ok'
    : 'wrong-password';
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
  const authEpoch = record && (await authEpochOf(record.name));
  if (!record || authEpoch === null) return null;

  const token = await mintToken(record.name, {
    authEpoch,
    sentTo: record.email,
  });
  return { ...token, username: record.name, email: record.email };
}

/**
 * Mints a link that proves an address answers. The address rides on the
 * token and is copied to the account when the link comes back: one stored
 * before it answers is a typo that mails the next reset link, and so the
 * account, to a stranger.
 *
 * `authEpoch` is the generation the caller's password check read. The link
 * dies with any password change after it, so somebody who had the
 * account cannot point its recovery at their own inbox while the owner is
 * taking it back.
 */
export async function createEmailToken(
  username: string,
  email: string,
  authEpoch: number,
): Promise<{ token: string; expiresAt: Date }> {
  return mintToken(username, { email, authEpoch });
}

/**
 * Spends an address token, which is when the address becomes real. Each
 * kind of token is spent only as itself, since whether it carries an
 * address is part of the match: an address token never sets a password,
 * and refusing one kind never consumes the other.
 */
export async function confirmEmailToken(token: string): Promise<ResetResult> {
  const row = await spendToken(token, true);
  if (!row?.email || typeof row.authEpoch !== 'number') return 'invalid-token';

  // Conditional on the generation for the same reason a password write is: a
  // change can land between the spend above and this write.
  const written = await PlayerModel.updateOne(
    { name: row.username, ...inEpoch(row.authEpoch) },
    { email: row.email },
  ).exec();
  return written.matchedCount === 1 ? 'ok' : 'invalid-token';
}

/** Spends a token. One use, and only while it is still in date. */
export async function consumeResetToken(
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  const row = await spendToken(token, false);
  if (typeof row?.authEpoch !== 'number') return 'invalid-token';

  return (await writePassword(row.username, newPassword, {
    authEpoch: row.authEpoch,
    sentTo: row.sentTo ?? undefined,
  }))
    ? 'ok'
    : 'invalid-token';
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
