import mongoose from 'mongoose';
import { config } from '../config.js';
import { logger } from '../logger.js';

const InstanceSchema = new mongoose.Schema({
  wsUrl: { type: String, required: true, unique: true },
  mapIds: { type: [String], required: true },
  // Set by the instance itself from its own beat, so every reader agrees on
  // when it is gone whatever heartbeat the reader runs with.
  expiresAt: { type: Date, required: true },
});
InstanceSchema.index({ mapIds: 1 });

const InstanceModel = mongoose.model('Instance', InstanceSchema);

const _cache = new Map<string, string>(); // mapId -> wsUrl

export async function registerInstance(
  wsUrl: string,
  mapIds: string[],
): Promise<void> {
  // Like the presence lease, three beats: missing one is not dying.
  const expiresAt = new Date(Date.now() + config.instance.heartbeatMs * 3);
  await InstanceModel.updateOne(
    { wsUrl },
    { wsUrl, mapIds, expiresAt },
    { upsert: true },
  );
}

export async function deregisterInstance(wsUrl: string): Promise<void> {
  await InstanceModel.deleteOne({ wsUrl });
}

export async function refreshRegistry(): Promise<void> {
  try {
    const docs = await InstanceModel.find({ expiresAt: { $gt: new Date() } })
      .lean()
      .exec();
    _cache.clear();
    for (const doc of docs) {
      for (const mapId of doc.mapIds) {
        _cache.set(mapId, doc.wsUrl);
      }
    }
  } catch (err) {
    logger.error('[instanceRegistry] refresh failed', { err });
  }
}

export function lookupInstanceUrl(mapId: string): string | undefined {
  return _cache.get(mapId);
}
