import mongoose from 'mongoose';

const NpcItemDropSchema = new mongoose.Schema(
  {
    itemId: Number,
    chance: Number,
  },
  { _id: false },
);

const NpcSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: String,
    width: Number,
    height: Number,
    sprite: Number,
    maxHealth: Number,
    attack: Number,
    attackRange: Number,
    behavior: String,
    experienceValue: Number,
    itemsToDrop: [NpcItemDropSchema],
  },
  { _id: false },
);

export default mongoose.model('Npc', NpcSchema);
