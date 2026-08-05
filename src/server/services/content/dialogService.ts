// Persistence and the in-memory cache for authored dialogs.
//
// Cached for the same reason loot tables are: a dialog is looked up from the
// npcInteract path, which runs inside the tick, where an async DB round trip is
// not an option.

import DialogModel from '../../model/Dialog.js';
import type { Dialog } from '../../../shared/types.js';

const dialogs = new Map<string, Dialog>();

export function getDialogById(id: string): Dialog | undefined {
  return dialogs.get(id);
}

/** Every loaded id, for validating content that references them. */
export function knownDialogIds(): Set<string> {
  return new Set(dialogs.keys());
}

export function cachedDialogs(): Dialog[] {
  return [...dialogs.values()];
}

export async function loadDialogs(): Promise<void> {
  const rows = await DialogModel.find().lean<Dialog[]>().exec();
  dialogs.clear();
  for (const row of rows) dialogs.set(row.id, row);
}

export async function listDialogs(): Promise<Dialog[]> {
  return await DialogModel.find().lean<Dialog[]>().exec();
}

export async function createOrUpdateDialog(dialog: Dialog): Promise<void> {
  await DialogModel.findOneAndUpdate({ id: dialog.id }, dialog, {
    upsert: true,
  });
  // Refresh the cache so an edit takes effect on the next conversation instead
  // of after a restart. Deep copy, unlike the flat loot table: the caller keeps
  // a reference to nodes and choices, and the cache is read inside the tick.
  dialogs.set(dialog.id, structuredClone(dialog));
}

export async function deleteDialog(id: string): Promise<void> {
  await DialogModel.deleteOne({ id });
  dialogs.delete(id);
}

export function clearDialogCache(): void {
  dialogs.clear();
}
