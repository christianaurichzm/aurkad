import mongoose from 'mongoose';

// The second factor, in its own collection rather than on the player
// document. The write-behind loop `$set`s the runtime player over its
// document (persistence/playerSnapshot.ts), so an in-flight session could
// put back a factor an operator turned off. And the secret is neither
// hashed nor derivable, so it stays out of every gameplay read.
const TwoFactorSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  /** Base32 (RFC 4648, unpadded), which is what an authenticator app reads. */
  secret: { type: String, required: true },
  enabledAt: { type: Date, default: Date.now },
  // The last 30-second step accepted for this account. A code is a bearer
  // secret for the length of its step: without this, one read over a shoulder
  // or off a screen share is good for the rest of that half minute.
  lastStep: { type: Number, default: 0 },
  /** bcrypt hashes of the printed codes. Each is removed as it is spent. */
  recovery: { type: [String], default: [] },
});

export default mongoose.model('TwoFactor', TwoFactorSchema);
