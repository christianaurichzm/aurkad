import mongoose from 'mongoose';
import { config } from '../config.js';

// One row per player per day played. Active players, new players,
// retention and session time are counts or sums over these rows. Per
// player-day, not per login, so a player reconnecting six times counts
// once, which the unique index below enforces. Not an event log: like the
// economy census, it counts what is there, not everything that happened.
const PlayerDaySchema = new mongoose.Schema({
  // Midnight UTC. A Date and not a `YYYY-MM-DD` string so the expiry below can
  // work on it and so a range of days is an ordinary range query. UTC because
  // the alternative is a day boundary that moves when the operator changes
  // machine or the clocks go back.
  day: { type: Date, required: true },
  player: { type: String, required: true },
  // The day the account was registered, copied in when the row is created,
  // so retention needs no join and a deleted account does not take its
  // cohort's history with it.
  cohort: { type: Date, required: true },
  /** Sessions started this day. Reconnects count; the row still counts once. */
  sessions: { type: Number, default: 0 },
  // Time played, attributed to the day the session STARTED, so a session that
  // crosses midnight is one session and not two halves. Fractional:
  // rounding each session to a whole minute turns a game of five-minute visits
  // into a graph of zeroes.
  minutes: { type: Number, default: 0 },
});

// What makes a row per player-day a row per player-day, and what the upsert on
// login relies on.
PlayerDaySchema.index({ day: 1, player: 1 }, { unique: true });
// Retention reads a cohort forwards in time.
PlayerDaySchema.index({ cohort: 1, day: 1 });
// Like the audit trail and the economy census, the database expires these
// rows. The reporting window is the retention window, so the default holds
// a year of cohorts plus their 30-day tail.
PlayerDaySchema.index(
  { day: 1 },
  { expireAfterSeconds: config.analytics.retentionDays * 24 * 60 * 60 },
);

export default mongoose.model('PlayerDay', PlayerDaySchema);
