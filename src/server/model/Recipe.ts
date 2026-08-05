import mongoose from 'mongoose';

const RecipeIngredientSchema = new mongoose.Schema(
  {
    itemId: { type: Number, required: true },
    quantity: { type: Number, required: true },
  },
  { _id: false },
);

const RecipeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    // Required, not `default: undefined`: a recipe consuming nothing is a free
    // item printer, so an empty list is a shape the document should not hold.
    // The optional lists elsewhere need the default; this one needs the floor.
    inputs: { type: [RecipeIngredientSchema], required: true },
    output: { type: RecipeIngredientSchema, required: true },
    // Names a predicate a script registers, like a loot entry's condition.
    condition: { type: String },
  },
  { _id: false },
);

export default mongoose.model('Recipe', RecipeSchema);
