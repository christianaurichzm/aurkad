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
    to: String,
    position: {
      x: Number,
      y: Number,
    },
  },
  { _id: false },
);

const TileSchema = new mongoose.Schema(
  {
    tileIndex: Number,
    blocked: Boolean,
    warp: WarpSchema,
    npcSpawn: String,
    item: Number,
    shop: String,
  },
  { _id: false },
);

const MapSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  type: String,
  tiles: [[TileSchema]],
  droppedItems: [DroppedItemSchema],
});

export default mongoose.model('GameMap', MapSchema);
