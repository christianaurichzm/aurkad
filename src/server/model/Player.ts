import mongoose from 'mongoose';
import { PositionSchema } from './schemas';

const InventoryItemSchema = new mongoose.Schema(
  {
    item: Number,
    quantity: Number,
  },
  { _id: false },
);

const InventorySchema = new mongoose.Schema(
  {
    items: [InventoryItemSchema],
    maxCapacity: Number,
  },
  { _id: false },
);

const EquippedItemsSchema = new mongoose.Schema(
  {
    weapon: { type: Number, ref: 'Item' },
    helmet: { type: Number, ref: 'Item' },
    chestplate: { type: Number, ref: 'Item' },
    gloves: { type: Number, ref: 'Item' },
    boots: { type: Number, ref: 'Item' },
  },
  { _id: false },
);

const PlayerSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  position: PositionSchema,
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
  level: Number,
  speed: Number,
  experience: Number,
  experienceToNextLevel: Number,
  inventory: InventorySchema,
  equipped: EquippedItemsSchema,
  access: Number,
});

export default mongoose.model('Player', PlayerSchema);
