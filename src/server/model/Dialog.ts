import mongoose from 'mongoose';

const DialogChoiceSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    // Absent ends the conversation, so it is optional rather than pointing at
    // a terminal node the designer would have to author.
    next: { type: String },
    // Names a predicate/handler a script registered, same as a loot entry's
    // condition. Stored so the wiring survives a restart.
    condition: { type: String },
    action: { type: String },
  },
  { _id: false },
);

const DialogNodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    // `default: undefined` for the same reason the editor omits the key: a node
    // that ends the conversation must not come back carrying an empty array,
    // which the next content export would write into dialogs.json.
    choices: { type: [DialogChoiceSchema], default: undefined },
  },
  { _id: false },
);

const DialogSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    start: { type: String },
    nodes: [DialogNodeSchema],
  },
  { _id: false },
);

export default mongoose.model('Dialog', DialogSchema);
