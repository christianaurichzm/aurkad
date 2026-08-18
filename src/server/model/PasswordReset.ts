import mongoose from 'mongoose';

// The token is stored as a hash, for the same reason the password next door is:
// a database someone can read must not also be a set of live reset links.
const PasswordResetSchema = new mongoose.Schema({
  username: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
});

// Expiry is enforced twice: Mongo sweeps on its own schedule, up to a minute
// late, so the read path checks the date too. The TTL is on a field with no
// other index, as `index: true` beside it makes mongoose emit only the plain
// one, and retention would silently not exist.
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('PasswordReset', PasswordResetSchema);
