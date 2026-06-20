import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema(
  {
    itemId: { type: Number, required: true },
    currency: { type: Number, required: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ShopSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  products: [ProductSchema],
});

export default mongoose.model('Shop', ShopSchema);
