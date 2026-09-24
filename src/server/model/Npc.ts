import mongoose from 'mongoose';

const NpcSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    sprite: { type: Number, min: 0 },
    maxHealth: { type: Number, min: 1 },
    attack: { type: Number, min: 0 },
    attackRange: { type: Number, min: 0 },
    behavior: {
      type: String,
      required: true,
      enum: [
        'aggressive',
        'hostile',
        'neutral',
        'friendly',
        'shopkeeper',
        'guard',
      ],
    },
    experienceValue: { type: Number, min: 0 },
    lootTableId: { type: String },
    // Conversation the dialog module opens on interact. Declared here or
    // mongoose drops it on write: the editor would save, the document would
    // come back without it, and talking to the npc would do nothing.
    dialogId: { type: String },
    // Quest the npc offers on interact. Same reason as dialogId above.
    questId: { type: String },
    scriptId: { type: String },
    scriptParams: { type: mongoose.Schema.Types.Mixed },
    // AI tuning in tiles, all optional: absent means the engine default for the
    // behaviour. Declared here or mongoose drops them, same trap as dialogId.
    sight: { type: Number, min: 1, max: 20 },
    pathDepth: { type: Number, min: 0, max: 40 },
    leash: { type: Number, min: 0, max: 60 },
    // Milliseconds, not tiles: how often this npc steps.
    moveIntervalMs: { type: Number, min: 50, max: 60_000 },
    // Milliseconds a killed npc stays off the map.
    respawnMs: { type: Number, min: 0, max: 3_600_000 },
  },
  { _id: false },
);

export default mongoose.model('Npc', NpcSchema);
