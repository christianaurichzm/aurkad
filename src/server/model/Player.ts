import mongoose from 'mongoose';
import { PositionSchema } from './schemas.js';

const InventoryItemSchema = new mongoose.Schema(
  {
    item: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const InventorySchema = new mongoose.Schema(
  {
    items: [InventoryItemSchema],
    maxCapacity: { type: Number, min: 1 },
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
  name: { type: String, required: true, unique: true },
  kind: { type: String, default: 'player' },
  position: PositionSchema,
  width: { type: Number, min: 0 },
  height: { type: Number, min: 0 },
  sprite: { type: Number, min: 0 },
  maxHealth: { type: Number, min: 1 },
  health: { type: Number, min: 0 },
  attack: { type: Number, min: 0 },
  strength: { type: Number, min: 0 },
  defense: { type: Number, min: 0 },
  agility: { type: Number, min: 0 },
  vitality: { type: Number, min: 0 },
  unspentPoints: { type: Number, min: 0 },
  direction: Number,
  action: {
    type: String,
    enum: ['Idle', 'Walk', 'Run', 'Attack'],
  },
  attackRange: { type: Number, min: 0 },
  mapId: String,
  level: { type: Number, min: 1 },
  speed: { type: Number, min: 0 },
  experience: { type: Number, min: 0 },
  experienceToNextLevel: { type: Number, min: 0 },
  inventory: InventorySchema,
  equipped: EquippedItemsSchema,
  equippedEffects: mongoose.Schema.Types.Mixed,
  access: { type: Number, enum: [0, 1, 2] },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  password: { type: String, required: true },
  // See PlayerRecord.authEpoch. Read by the session middleware through its own
  // projected query and stripped by normalizePlayerRecord, so it never reaches
  // runtime state and the snapshot loop cannot write a stale copy back.
  authEpoch: { type: Number, default: 0 },
  // Set only by the account routes, after a link sent to it came back: an
  // address nobody answered is a reset link addressed to a typo.
  email: { type: String, lowercase: true, trim: true },
  // Which instance may write this document, and until when. Written and read
  // only by persistence/presence.ts, and stripped on the way out by
  // normalizePlayerRecord: a lease that reached runtime state would be
  // written back by the snapshot loop, bringing a released lease back to life.
  lease: {
    owner: String,
    token: String,
    until: Number,
  },
});

export default mongoose.model('Player', PlayerSchema);
