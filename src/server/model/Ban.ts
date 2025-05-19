import mongoose from 'mongoose';

const BanSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  until: Number,
  reason: String,
});

export default mongoose.model('Ban', BanSchema);
