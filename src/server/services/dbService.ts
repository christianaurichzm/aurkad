import mongoose from 'mongoose';

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
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
