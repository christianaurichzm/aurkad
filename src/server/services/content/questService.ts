// Authored quests. Cached: the quest module checks objectives from npcDeath,
// itemPickup, npcInteract and tileEnter, all of which run inside the tick.

import { z } from 'zod';
import QuestModel from '../../model/Quest.js';
import { contentCache } from '../../persistence/contentCache.js';
import type { Quest } from '../../../shared/types.js';

// A discriminated union, so "kill" cannot be saved with a mapId and "reach"
// cannot be saved without one; with every field optional, an objective
// nothing can complete could be authored.
const QuestObjectiveSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('kill'),
    npcId: z.string().min(1).max(64),
    count: z.number().int().positive().max(10_000),
  }),
  z.object({
    type: z.literal('collect'),
    itemId: z.number().int().nonnegative(),
    count: z.number().int().positive().max(10_000),
  }),
  z.object({ type: z.literal('talk'), npcId: z.string().min(1).max(64) }),
  z.object({
    type: z.literal('reach'),
    mapId: z.string().min(1).max(64),
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
  }),
]);

export const QuestSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  objective: QuestObjectiveSchema,
  reward: z
    .object({
      experience: z.number().int().nonnegative().optional(),
      items: z
        .array(
          z.object({
            itemId: z.number().int().nonnegative(),
            quantity: z.number().int().positive(),
          }),
        )
        .max(20)
        .optional(),
      script: z.string().min(1).max(64).optional(),
    })
    .optional(),
});

const quests = contentCache<Quest>(QuestModel, QuestSchema);

export const getQuestById = quests.get;
export const cachedQuests = quests.all;
export const loadQuests = quests.load;
export const listQuests = quests.list;
export const createOrUpdateQuest = quests.upsert;
export const deleteQuest = quests.remove;
export const clearQuestCache = quests.clear;
