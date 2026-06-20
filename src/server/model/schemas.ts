import mongoose from 'mongoose';
import { EQUIPMENT_SLOTS } from '../../shared/constants.js';

export const PositionSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  { _id: false },
);

export const EffectSchema = new mongoose.Schema(
  {
    attribute: {
      type: String,
      required: true,
      enum: [
        'health',
        'maxHealth',
        'attack',
        'speed',
        'attackRange',
        'experience',
        'experienceToNextLevel',
        'level',
      ],
    },
    type: { type: String, required: true, enum: ['add', 'multiply'] },
    value: { type: Number, required: true },
  },
  { _id: false },
);

export const ItemSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    sprite: { type: Number, required: true, min: 0 },
    type: {
      type: String,
      required: true,
      enum: [...EQUIPMENT_SLOTS, 'consumable', 'money'],
    },
    effects: [EffectSchema],
  },
  { _id: false },
);
