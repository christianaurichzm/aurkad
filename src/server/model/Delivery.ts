import mongoose from 'mongoose';

// An item owed to a player, held until they can take it.
//
// Its own collection: the recipient may be offline, and their
// document is written wholesale from memory by the snapshot loop whenever they
// are online, so anything queued into that document while they play would be
// overwritten by the next flush. Nothing else writes here, so a queued row
// cannot be clobbered by a concurrent session.
const DeliverySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  /** Recipient player name, canonical case. */
  to: { type: String, required: true, index: true },
  itemId: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  /** Module or script that queued it, for auditing an unexpected item. */
  source: { type: String, required: true },
  /** Payload owned by whoever queued it (sender, message, expiry). */
  meta: { type: mongoose.Schema.Types.Mixed },
  /**
   * Set by a sender that must not pay twice. A keyed row stays once claimed,
   * as the receipt that refuses the key again for that recipient.
   */
  key: { type: String },
  claimedAt: { type: Number },
  createdAt: { type: Number, required: true },
});

DeliverySchema.index(
  { to: 1, key: 1 },
  { unique: true, partialFilterExpression: { key: { $exists: true } } },
);

export default mongoose.model('Delivery', DeliverySchema);
