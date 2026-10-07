import mongoose from 'mongoose';

const DroppedItemSchema = new mongoose.Schema(
  {
    position: {
      x: Number,
      y: Number,
    },
    itemId: Number,
    sprite: Number,
    // Declared or mongoose drops it on write, and the map then exports drops
    // the pack schema refuses: the whole next import is turned away.
    quantity: Number,
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
    scriptParams: { type: mongoose.Schema.Types.Mixed },
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
    tileIndex: { type: Number, required: true, min: -1 },
    blocked: Boolean,
    warp: WarpSchema,
    npcSpawn: String,
    item: Number,
    shop: String,
    bank: Boolean,
    avoidNpc: Boolean,
    fringeIndex: Number,
    maskIndex: Number,
    triggers: [TileActionSchema],
    door: DoorSchema,
    conditionalBlock: String,
  },
  { _id: false },
);

const BorderLinkSchema = new mongoose.Schema(
  {
    to: { type: String, required: true },
    offset: Number,
    position: { x: Number, y: Number },
  },
  { _id: false },
);

const BorderLinksSchema = new mongoose.Schema(
  {
    up: BorderLinkSchema,
    down: BorderLinkSchema,
    left: BorderLinkSchema,
    right: BorderLinkSchema,
  },
  { _id: false },
);

const MapSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, required: true, enum: ['pvp', 'normal'] },
  orientation: { type: String, enum: ['orthogonal', 'isometric'] },
  pvp: { type: String, enum: ['safe', 'normal', 'no-penalty'] },
  // A dungeon: entered as a copy per player or party. Here rather than in
  // game.json because it is a fact about this place, and whoever draws the map
  // is who decides it.
  instanced: { type: Boolean },
  tiles: [[TileSchema]],
  droppedItems: [DroppedItemSchema],
  music: String,
  borderLinks: BorderLinksSchema,
});

export default mongoose.model('GameMap', MapSchema);
