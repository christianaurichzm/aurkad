// Authored dialogs. Cached: a dialog is looked up from the npcInteract path,
// which runs inside the tick.

import DialogModel from '../../model/Dialog.js';
import { contentCache } from '../../persistence/contentCache.js';
import type { Dialog } from '../../../shared/types.js';

const dialogs = contentCache<Dialog>(DialogModel);

export const getDialogById = dialogs.get;
export const cachedDialogs = dialogs.all;
export const loadDialogs = dialogs.load;
export const listDialogs = dialogs.list;
export const createOrUpdateDialog = dialogs.upsert;
export const deleteDialog = dialogs.remove;
export const clearDialogCache = dialogs.clear;
