// Authored quests. Cached: the quest module checks objectives from npcDeath,
// itemPickup, npcInteract and tileEnter, all of which run inside the tick.

import QuestModel from '../../model/Quest.js';
import { contentCache } from '../../persistence/contentCache.js';
import type { Quest } from '../../../shared/types.js';

const quests = contentCache<Quest>(QuestModel);

export const getQuestById = quests.get;
export const cachedQuests = quests.all;
export const loadQuests = quests.load;
export const listQuests = quests.list;
export const createOrUpdateQuest = quests.upsert;
export const deleteQuest = quests.remove;
export const clearQuestCache = quests.clear;
