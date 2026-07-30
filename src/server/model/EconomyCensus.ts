import mongoose from 'mongoose';
import { config } from '../config.js';

// A count of every item in the world at one moment.
//
// Stored rather than kept in memory because the comparison that matters spans
// restarts: "gold doubled since last night" is unanswerable if the baseline
// died with the process, and a restart is exactly when someone would hope the
// evidence goes away.
const EconomyCensusSchema = new mongoose.Schema({
  // No `index: true` here: the TTL index below is on the same key, and
  // declaring both makes mongoose create the plain one and skip the TTL, which
  // is retention silently not happening.
  at: { type: Date, required: true },
  players: { type: Number, required: true },
  items: [
    {
      _id: false,
      itemId: { type: Number, required: true },
      total: { type: Number, required: true },
      byLocation: { type: mongoose.Schema.Types.Mixed },
      topHolders: [{ _id: false, name: String, quantity: Number }],
    },
  ],
});

// Same reasoning as the audit trail: a periodic job writes these forever, so
// the database expires them instead of an operator remembering to.
EconomyCensusSchema.index(
  { at: 1 },
  { expireAfterSeconds: config.economy.censusRetentionDays * 24 * 60 * 60 },
);

export default mongoose.model('EconomyCensus', EconomyCensusSchema);
