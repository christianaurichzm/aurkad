import BanModel from '../model/Ban.js';

export async function getBan(username: string) {
  return await BanModel.findOne({ username }).lean();
}

export async function banPlayer(
  username: string,
  reason?: string,
  until?: number,
) {
  await BanModel.findOneAndUpdate(
    { username },
    { username, reason, until },
    { upsert: true },
  );
}

export async function unbanPlayer(username: string) {
  await BanModel.deleteOne({ username });
}
