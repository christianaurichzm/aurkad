import mongoose from 'mongoose';

// Mixed rather than a union: `quantity` is either a number or a {min,max}, and
// mongoose has no discriminated-union primitive. The zod schemas on the routes
// and the content import are what actually validate the shape.
const LootEntrySchema = new mongoose.Schema(
  {
    itemId: { type: Number, required: true },
    weight: { type: Number, min: 0 },
    chance: { type: Number, min: 0, max: 1 },
    quantity: { type: mongoose.Schema.Types.Mixed },
    // Names a predicate a script registers as `lootCondition.<name>`. Declared
    // so it survives a restart: a field the model drops silently does nothing.
    condition: { type: String },
  },
  { _id: false },
);

const LootTableSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    guaranteed: [LootEntrySchema],
    rolls: {
      type: { min: Number, max: Number },
      _id: false,
    },
    entries: [LootEntrySchema],
    emptyWeight: { type: Number, min: 0 },
  },
  { _id: false },
);

export default mongoose.model('LootTable', LootTableSchema);
