import BanModel from '../../model/Ban.js';

export async function getBan(username: string) {
  return BanModel.findOne({ username }).lean().exec();
}

export async function banPlayer(
  username: string,
  reason?: string,
  until?: number,
): Promise<void> {
  await BanModel.findOneAndUpdate(
    { username },
    { username, reason, until },
    { upsert: true },
  );
}

export async function unbanPlayer(username: string): Promise<void> {
  await BanModel.deleteOne({ username });
}
