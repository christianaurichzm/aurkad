import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema(
  {
    itemId: Number,
    currency: Number,
    price: Number,
  },
  { _id: false },
);

const ShopSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  products: [ProductSchema],
});

export default mongoose.model('Shop', ShopSchema);
