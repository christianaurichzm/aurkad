import mongoose from 'mongoose';

export const PositionSchema = new mongoose.Schema(
  {
    x: Number,
    y: Number,
  },
  { _id: false },
);

export const EffectSchema = new mongoose.Schema(
  {
    attribute: String,
    type: String,
    value: Number,
  },
  { _id: false },
);

export const ItemSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    name: String,
    description: String,
    sprite: Number,
    type: String,
    effects: [EffectSchema],
  },
  { _id: false },
);
