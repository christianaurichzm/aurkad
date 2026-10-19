// Authored dialogs. Cached: a dialog is looked up from the npcInteract path,
// which runs inside the tick.

import { z } from 'zod';
import DialogModel from '../../model/Dialog.js';
import { contentCache } from '../../persistence/contentCache.js';
import type { Dialog } from '../../../shared/types.js';

// Bounds on an authored conversation. The values land in a document that is
// loaded whole on every server start and read from inside the tick, so the
// limits are what a designer can plausibly write rather than what JSON allows.
// Nine choices is the ceiling because the shipped dialog client binds number
// keys 1-9: a tenth option exists but cannot be picked from the keyboard.
const DialogChoiceSchema = z.object({
  label: z.string().min(1).max(120),
  next: z.string().min(1).max(64).optional(),
  condition: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(64).optional(),
});

const DialogNodeSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(2000),
  choices: z.array(DialogChoiceSchema).max(9).optional(),
});

export const DialogSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  start: z.string().min(1).max(64).optional(),
  nodes: z.array(DialogNodeSchema).min(1).max(100),
});

const dialogs = contentCache<Dialog>(DialogModel);

export const getDialogById = dialogs.get;
export const cachedDialogs = dialogs.all;
export const loadDialogs = dialogs.load;
export const listDialogs = dialogs.list;
export const createOrUpdateDialog = dialogs.upsert;
export const deleteDialog = dialogs.remove;
export const clearDialogCache = dialogs.clear;
