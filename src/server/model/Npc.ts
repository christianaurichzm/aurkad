import mongoose from 'mongoose';

const NpcItemDropSchema = new mongoose.Schema(
  {
    itemId: Number,
    chance: Number,
  },
  { _id: false },
);

const NpcSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  position: {
    x: Number,
    y: Number,
  },
  width: Number,
  height: Number,
  sprite: Number,
  maxHealth: Number,
  health: Number,
  attack: Number,
  direction: Number,
  action: String,
  attackRange: Number,
  mapId: String,
  behavior: String,
  experienceValue: Number,
  itemsToDrop: [NpcItemDropSchema],
});

export default mongoose.model('Npc', NpcSchema);
