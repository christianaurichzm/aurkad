import crypto from 'node:crypto';
import PlayerModel from '../model/Player.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Which instance owns an account, so only one of them writes it. Players
 * are flushed whole from memory every few seconds, so two processes holding
 * one account never collide: they take turns, the last write wins, and the
 * lost XP has no other symptom.
 *
 * The lease is a field on the player document, so the fence below filters
 * the document the write already targets and "am I still the owner" and
 * "write this" are one operation. In two collections a process paused long
 * enough to lose the lease could still finish its write.
 *
 * Off without `WS_PUBLIC_URL`: the process has no identity to hold a lease
 * with and no second writer, and an operator would only be locked out by a
 * lease a crashed process never released.
 */

const owner = config.instance.wsPublicUrl;

// Renewed once per heartbeat, and worth three of them: one missed beat (a slow
// query, a pause) must not hand the account to somebody else while the player
// is still playing on this one.
const LEASE_MS = config.instance.heartbeatMs * 3;

/** playerId -> the lease this process holds. */
const held = new Map<string, { name: string; token: string }>();

export type PresenceResult = { ok: true } | { ok: false; owner: string };

/**
 * Takes the account for this instance, or says who has it. One conditional
 * update on one document, so atomic: the filter is "free, expired or already
 * mine". Two instances racing a login both send it, and the loser matches
 * nothing and reads back the winner.
 */
export async function acquirePresence(
  id: string,
  name: string,
): Promise<PresenceResult> {
  if (!owner) return { ok: true };

  const now = Date.now();
  const token = crypto.randomUUID();
  const taken = await PlayerModel.findOneAndUpdate(
    {
      id,
      $or: [
        { 'lease.until': { $exists: false } },
        { 'lease.until': { $lte: now } },
        { 'lease.owner': owner },
      ],
    },
    { $set: { lease: { owner, token, until: now + LEASE_MS } } },
  ).lean();

  if (!taken) {
    const current = await PlayerModel.findOne({ id })
      .select('lease')
      .lean<{ lease?: { owner?: string } }>();
    return { ok: false, owner: current?.lease?.owner ?? 'another instance' };
  }

  held.set(id, { name, token });
  return { ok: true };
}

/**
 * The filter that makes a write conditional on still owning the account.
 * Empty when this process holds no lease for the player (presence off, or
 * an operator editing an offline account). A lost lease stays in the map
 * with a token that matches nothing, so later writes are refused instead of
 * landing over the instance that took over.
 */
export function presenceFence(id: string): Record<string, unknown> {
  const lease = held.get(id);
  return lease ? { 'lease.token': lease.token } : {};
}

/** Pushes the expiry of everything this instance holds, once per heartbeat. */
export async function renewPresence(): Promise<void> {
  if (!owner || held.size === 0) return;

  const tokens = [...held.values()].map((lease) => lease.token);
  const result = await PlayerModel.updateMany(
    { 'lease.token': { $in: tokens } },
    { $set: { 'lease.until': Date.now() + LEASE_MS } },
  );

  // A lease that no longer matches its token was taken by somebody else, so
  // this process was late enough to look dead. The fence already refuses its
  // writes for that player; this line says why.
  if (result.matchedCount < tokens.length) {
    logger.error('[presence] lease lost while still holding the player', {
      held: tokens.length,
      renewed: result.matchedCount,
    });
  }
}

/**
 * Everybody logged in anywhere, from the leases themselves. This process's
 * socket map only answers "who is on this instance". A lease is taken at
 * login and freed at logout, the source the login itself consults.
 * Undefined when presence is off, as the socket map is then the answer.
 */
export async function listOnlineEverywhere(): Promise<string[] | undefined> {
  if (!owner) return undefined;

  const docs = await PlayerModel.find({ 'lease.until': { $gt: Date.now() } })
    .select('name')
    .lean<{ name: string }[]>();
  return docs.map((doc) => doc.name);
}

/**
 * Which other instance holds this player's account, or null when presence
 * is off, nobody holds the name or this process does. Matched exactly, like
 * `getPlayerByName`, so the two lookups agree on which name is which.
 */
export async function leaseHolderOf(name: string): Promise<string | null> {
  if (!owner) return null;

  const doc = await PlayerModel.findOne({
    name,
    'lease.until': { $gt: Date.now() },
  })
    .select('lease.owner')
    .lean<{ lease?: { owner?: string } }>();

  const holder = doc?.lease?.owner;
  return holder && holder !== owner ? holder : null;
}

export async function releasePresence(id: string): Promise<void> {
  const lease = held.get(id);
  if (!lease) return;

  held.delete(id);
  await PlayerModel.updateOne(
    { id, 'lease.token': lease.token },
    { $unset: { lease: '' } },
  );
}

/**
 * Hands every account back on the way out, so a restart does not make its own
 * players wait for the expiry of leases nobody is using.
 */
export async function releaseAllPresence(): Promise<void> {
  if (held.size === 0) return;

  const tokens = [...held.values()].map((lease) => lease.token);
  held.clear();
  await PlayerModel.updateMany(
    { 'lease.token': { $in: tokens } },
    { $unset: { lease: '' } },
  );
}
