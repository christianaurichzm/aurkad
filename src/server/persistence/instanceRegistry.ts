import mongoose from 'mongoose';
import { logger } from '../logger.js';

const InstanceSchema = new mongoose.Schema({
  wsUrl: { type: String, required: true, unique: true },
  mapIds: { type: [String], required: true },
  updatedAt: { type: Date, default: Date.now },
});
InstanceSchema.index({ mapIds: 1 });

const InstanceModel = mongoose.model('Instance', InstanceSchema);

const _cache = new Map<string, string>(); // mapId -> wsUrl
const STALE_MS = 90_000; // skip entries not refreshed in 90s

export async function registerInstance(
  wsUrl: string,
  mapIds: string[],
): Promise<void> {
  await InstanceModel.updateOne(
    { wsUrl },
    { wsUrl, mapIds, updatedAt: new Date() },
    { upsert: true },
  );
}

export async function deregisterInstance(wsUrl: string): Promise<void> {
  await InstanceModel.deleteOne({ wsUrl });
}

export async function refreshRegistry(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const docs = await InstanceModel.find({ updatedAt: { $gte: cutoff } })
      .lean()
      .exec();
    _cache.clear();
    for (const doc of docs) {
      for (const mapId of doc.mapIds as string[]) {
        _cache.set(mapId, doc.wsUrl as string);
      }
    }
  } catch (err) {
    logger.error('[instanceRegistry] refresh failed', { err });
  }
}

export function lookupInstanceUrl(mapId: string): string | undefined {
  return _cache.get(mapId);
}
