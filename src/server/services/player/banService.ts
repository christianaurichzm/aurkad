import BanModel from '../../model/Ban.js';

export async function getBan(username: string) {
  return BanModel.findOne({ username }).lean().exec();
}

/**
 * The ban that holds on `username` at this moment. One whose time ran out
 * is cleared on the way, so the next read finds nothing either.
 */
export async function activeBan(username: string) {
  const ban = await getBan(username);
  if (!ban) return null;
  if (!ban.until || Date.now() < ban.until) return ban;
  await unbanPlayer(username);
  return null;
}

export async function banPlayer(
  username: string,
  reason?: string,
  until?: number,
): Promise<void> {
  // Replaced whole, so a permanent ban does not keep the expiry of the
  // temporary one before it.
  await BanModel.replaceOne(
    { username },
    { username, reason, until },
    { upsert: true },
  );
}

export async function unbanPlayer(username: string): Promise<void> {
  await BanModel.deleteOne({ username });
}
