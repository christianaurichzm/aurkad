import mongoose from 'mongoose';

// One document per recipient, keyed by their name, that every send to them
// writes before counting their pending rows. What it holds means nothing: the
// write is the point, as two transactions writing one document conflict.
const DeliveryGuardSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sends: { type: Number },
});

export default mongoose.model('DeliveryGuard', DeliveryGuardSchema);
