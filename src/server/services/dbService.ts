import mongoose from 'mongoose';

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 1 },
});

const Counter = mongoose.model('Counter', CounterSchema);

export async function getNextItemId(): Promise<number> {
  const result = await Counter.findByIdAndUpdate(
    'item',
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );

  return result.seq;
}

export async function getNextNpcId(): Promise<number> {
  const result = await Counter.findByIdAndUpdate(
    'npc',
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );

  return result.seq;
}

export async function getNextMapId(): Promise<number> {
  const result = await Counter.findByIdAndUpdate(
    'map',
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );

  return result.seq;
}

/**
 * Raises a counter above the ids already in a collection. Documents arrive
 * through the counter (editor "create") and through content files or a
 * seed with their own ids, which leave it alone: after a pack with items
 * 1-8, the editor's next item would get id 1 and be upserted over the
 * pack's. Never lowers it, since a gap is harmless and a reused id is not.
 */
export async function raiseCounter(
  name: 'item' | 'npc' | 'map',
  highestId: number,
): Promise<void> {
  if (!Number.isFinite(highestId) || highestId <= 0) return;
  await Counter.findByIdAndUpdate(
    name,
    { $max: { seq: Math.floor(highestId) } },
    { upsert: true },
  );
}
