import mongoose from 'mongoose';

const NpcItemDropSchema = new mongoose.Schema(
  {
    itemId: { type: Number, required: true },
    chance: { type: Number, required: true, min: 0, max: 1 },
    quantity: { type: Number, min: 1, default: 1 },
  },
  { _id: false },
);

const NpcSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    sprite: { type: Number, min: 0 },
    maxHealth: { type: Number, min: 1 },
    attack: { type: Number, min: 0 },
    attackRange: { type: Number, min: 0 },
    behavior: {
      type: String,
      required: true,
      enum: [
        'aggressive',
        'hostile',
        'neutral',
        'friendly',
        'shopkeeper',
        'guard',
      ],
    },
    experienceValue: { type: Number, min: 0 },
    itemsToDrop: [NpcItemDropSchema],
    scriptId: { type: String },
  },
  { _id: false },
);

export default mongoose.model('Npc', NpcSchema);
