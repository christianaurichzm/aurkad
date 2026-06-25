import mongoose from 'mongoose';

const ArrowSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    sprite: { type: Number, required: true, min: 0 },
    damage: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

export default mongoose.model('Arrow', ArrowSchema);
