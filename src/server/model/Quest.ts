import mongoose from 'mongoose';

// One schema for every objective arm rather than a discriminator per type:
// mongoose would drop a field it does not declare, and the arms disagree on
// which fields exist. The zod schema in bodySchemas.ts is what refuses a
// half-filled objective; this layer only has to keep the values.
const QuestObjectiveSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    npcId: { type: String },
    itemId: { type: Number },
    count: { type: Number },
    mapId: { type: String },
    row: { type: Number },
    col: { type: Number },
  },
  { _id: false },
);

const QuestRewardItemSchema = new mongoose.Schema(
  {
    itemId: { type: Number, required: true },
    quantity: { type: Number, required: true },
  },
  { _id: false },
);

const QuestRewardSchema = new mongoose.Schema(
  {
    experience: { type: Number },
    // `default: undefined`, or mongoose stores an empty array for a reward
    // with no items and the next content export writes it into quests.json.
    items: { type: [QuestRewardItemSchema], default: undefined },
    // Names a handler a script registered, like a dialog action. Stored so the
    // wiring survives a restart.
    script: { type: String },
  },
  { _id: false },
);

const QuestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    objective: { type: QuestObjectiveSchema, required: true },
    reward: { type: QuestRewardSchema },
  },
  { _id: false },
);

export default mongoose.model('Quest', QuestSchema);
