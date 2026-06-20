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
  },
  { _id: false },
);

const MapSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, required: true, enum: ['pvp', 'normal'] },
  tiles: [[TileSchema]],
  droppedItems: [DroppedItemSchema],
});

export default mongoose.model('GameMap', MapSchema);
