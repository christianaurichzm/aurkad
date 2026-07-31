import mongoose from 'mongoose';

// A gameplay switch an operator can flip while the server runs.
//
// Persisted because the alternative is worse than it looks: a double-XP weekend
// that silently ends because someone deployed on Saturday is a live-ops
// incident, not a restart. The flag outlives the process that set it.
//
// One document per flag rather than one document holding them all, so two
// operators changing different flags cannot overwrite each other.
const LiveOpsFlagSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  /** Scalar only: it travels as a command argument and in a document. */
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  /**
   * When the flag starts applying. Absent means "now". A flag scheduled for
   * Saturday has to be a row, not a timer: the process that took the command
   * will not be the one running when it starts.
   */
  startsAt: { type: Date },
  /**
   * When the flag stops applying, checked on read: a TTL index is swept
   * about once a minute, which would be a minute of unintended double XP.
   */
  expiresAt: { type: Date },
  setBy: { type: String },
  setAt: { type: Date, required: true },
  /** Free text from the operator: why this is on. */
  note: { type: String },
});

export default mongoose.model('LiveOpsFlag', LiveOpsFlagSchema);
