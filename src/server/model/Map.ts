import mongoose from 'mongoose';

const DroppedItemSchema = new mongoose.Schema(
  {
    position: {
      x: Number,
      y: Number,
    },
    itemId: Number,
    sprite: Number,
  },
  { _id: false },
);

const WarpSchema = new mongoose.Schema(
  {
    to: { type: String, required: true },
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
  },
  { _id: false },
);

const TileActionSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: ['heal', 'kill', 'message', 'sound', 'changeSprite', 'script'],
    },
    text: String,
    file: String,
    spriteId: Number,
    scriptId: String,
  },
  { _id: false },
);

const DoorSchema = new mongoose.Schema(
  {
    requiresItem: { type: Number, required: true },
    openTileIndex: { type: Number, required: true },
  },
  { _id: false },
);

const TileSchema = new mongoose.Schema(
  {
    tileIndex: { type: Number, required: true, min: 0 },
    blocked: Boolean,
    warp: WarpSchema,
    npcSpawn: String,
    item: Number,
    shop: String,
    avoidNpc: Boolean,
    fringe: Boolean,
    mask: Boolean,
    triggers: [TileActionSchema],
    door: DoorSchema,
    conditionalBlock: String,
  },
  { _id: false },
);

const BorderLinksSchema = new mongoose.Schema(
  {
    up: WarpSchema,
    down: WarpSchema,
    left: WarpSchema,
    right: WarpSchema,
  },
  { _id: false },
);

const MapSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, required: true, enum: ['pvp', 'normal'] },
  pvp: { type: String, enum: ['safe', 'normal', 'no-penalty'] },
  tiles: [[TileSchema]],
  droppedItems: [DroppedItemSchema],
  music: String,
  borderLinks: BorderLinksSchema,
});

export default mongoose.model('GameMap', MapSchema);
