import mongoose from 'mongoose';

// The item stays in escrow until a sale or a return commits. An unpaid row
// holds the seller's proceeds after the buyer's inventory has been committed.
const AuctionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  state: { type: String, enum: ['active', 'unpaid'], required: true },
  seller: { type: String, required: true, index: true },
  itemId: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 1 },
  listedAt: { type: Number, required: true },
  expiresAt: { type: Number, required: true },
  currencyItemId: Number,
  payout: Number,
});
AuctionSchema.index({ state: 1, expiresAt: 1 });
export default mongoose.model('Auction', AuctionSchema);
