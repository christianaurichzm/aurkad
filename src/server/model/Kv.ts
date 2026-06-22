import mongoose from 'mongoose';

// Scoped key-value store for game scripts. `scope` is an arbitrary namespace
// chosen by the script (e.g. "global", "guild:dragons", "leaderboard").
const KvSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true },
    key: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

KvSchema.index({ scope: 1, key: 1 }, { unique: true });

export default mongoose.model('Kv', KvSchema);
