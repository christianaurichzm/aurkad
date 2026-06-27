import mongoose from 'mongoose';

const ArrowSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    sprite: { type: Number, required: true, min: 0 },
    damage: { type: Number, required: true, min: 0, default: 0 },
    rangeTiles: { type: Number, min: 1 },
    tileSpeed: { type: Number, min: 1 },
  },
  { _id: false },
);

export default mongoose.model('Arrow', ArrowSchema);
