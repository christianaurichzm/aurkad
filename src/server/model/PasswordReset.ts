import mongoose from 'mongoose';

// A single-use, short-lived bearer token bound to an account, stored as a
// hash like the password, so a readable database is not a set of live links.
// With `email` it confirms that address; without, it sets a new password.
// One collection, so a password change clears both kinds.
const PasswordResetSchema = new mongoose.Schema({
  username: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  email: { type: String, lowercase: true, trim: true },
  // A reset link's account generation when it was minted. A password written
  // after that is a reason the link must not work, even mid-spend.
  authEpoch: Number,
});

// Expiry is enforced twice: Mongo sweeps on its own schedule, up to a minute
// late, so the read path checks the date too. The TTL is on a field with no
// other index, as `index: true` beside it makes mongoose emit only the plain
// one, and retention would silently not exist.
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('PasswordReset', PasswordResetSchema);
