// Persistence and the in-memory cache for authored quests.
//
// Cached for the same reason dialogs and loot tables are: the quest module
// checks a player's objectives from npcDeath, itemPickup, npcInteract and
// tileEnter, all of which run inside the tick, where an async DB round trip is
// not an option.

import QuestModel from '../../model/Quest.js';
import type { Quest } from '../../../shared/types.js';

const quests = new Map<string, Quest>();

export function getQuestById(id: string): Quest | undefined {
  return quests.get(id);
}

/** Every loaded id, for validating content that references them. */
export function knownQuestIds(): Set<string> {
  return new Set(quests.keys());
}

export function cachedQuests(): Quest[] {
  return [...quests.values()];
}

export async function loadQuests(): Promise<void> {
  const rows = await QuestModel.find().lean<Quest[]>().exec();
  quests.clear();
  for (const row of rows) quests.set(row.id, row);
}

export async function listQuests(): Promise<Quest[]> {
  return await QuestModel.find().lean<Quest[]>().exec();
}

export async function createOrUpdateQuest(quest: Quest): Promise<void> {
  await QuestModel.findOneAndUpdate({ id: quest.id }, quest, { upsert: true });
  // Refresh the cache so an edit takes effect on the next kill instead of after
  // a restart. Deep copy, like the dialog: the caller keeps a reference to the
  // objective and reward, and the cache is read inside the tick.
  quests.set(quest.id, structuredClone(quest));
}

export async function deleteQuest(id: string): Promise<void> {
  await QuestModel.deleteOne({ id });
  quests.delete(id);
}

export function clearQuestCache(): void {
  quests.clear();
}
