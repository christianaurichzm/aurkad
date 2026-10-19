import { z } from 'zod';
import { CharacterAction, PersistentNpc } from '../../../shared/types.js';
import { runtimeState } from '../../sim/state.js';
import NpcModel from '../../model/Npc.js';
import { absentOptionalKeys, getNextNpcId, unsetAbsent } from '../dbService.js';
import { resetNpcAi } from '../npc/aiBrain.js';
import { despawnNpc } from '../npc/spawn.js';
import { logger } from '../../logger.js';
import { ScriptParamsSchema } from '../../../shared/scriptParams.js';

const NpcBehaviorSchema = z.enum([
  'aggressive',
  'hostile',
  'neutral',
  'friendly',
  'shopkeeper',
  'guard',
]);

export const NpcSchema = z.object({
  name: z.string().min(1),
  sprite: z.number().int().nonnegative(),
  maxHealth: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  behavior: NpcBehaviorSchema,
  experienceValue: z.number().int().nonnegative().optional(),
  lootTableId: z.string().optional(),
  dialogId: z.string().optional(),
  // Declared here or the field never reaches mongoose: z.object strips what it
  // does not know, so the editor would save and the npc would come back
  // without the quest it offers.
  questId: z.string().optional(),
  scriptId: z.string().optional(),
  scriptParams: ScriptParamsSchema.optional(),
  // AI tuning in tiles. Clamped here rather than defaulted: absent has to stay
  // absent so the engine default for the behaviour keeps applying, and a sight
  // of 200 tiles would make every npc query the whole map.
  sight: z.number().int().min(1).max(20).optional(),
  pathDepth: z.number().int().min(0).max(40).optional(),
  leash: z.number().int().min(0).max(60).optional(),
  // Milliseconds between steps. Floored at one tick at 20 Hz; a minute is
  // already a statue that twitches.
  moveIntervalMs: z.number().int().min(50).max(60_000).optional(),
  // Milliseconds dead before coming back. An hour is a raid boss; past that it
  // is a one-off, which is a script's job, not a timer's.
  respawnMs: z.number().int().min(0).max(3_600_000).optional(),
});

// Without the document's _id and __v: callers spread this into live npcs,
// which serialization sends almost whole, so _id would be stringified for
// every npc's delta check on every tick.
export async function getNpcById(id: string): Promise<PersistentNpc | null> {
  return await NpcModel.findOne({ id }, { _id: 0, __v: 0 })
    .lean<PersistentNpc>()
    .exec();
}

export async function createOrUpdateNpc(
  npc: Partial<PersistentNpc>,
): Promise<void> {
  if (!npc.id) {
    npc.id = (await getNextNpcId()).toString();
  }

  await NpcModel.findOneAndUpdate(
    { id: npc.id },
    { $set: npc, ...unsetAbsent(NpcSchema, npc) },
    { upsert: true },
  );
}

export async function updateNpcAll(
  id: string,
  updates: Partial<PersistentNpc>,
): Promise<PersistentNpc | undefined> {
  if (!id) return;

  const updated = await NpcModel.findOneAndUpdate(
    { id },
    { $set: updates, ...unsetAbsent(NpcSchema, updates) },
    { returnDocument: 'after' },
  )
    .lean<PersistentNpc>()
    .exec();

  // Fire and forget: the caller is an admin HTTP route and the runtime refresh
  // is best-effort. Catch anyway, or a failure here surfaces as an unhandled
  // rejection with no context.
  void refreshNpcInRuntime(id).catch((err) =>
    logger.error('[npc] runtime refresh after update failed', { id, err }),
  );

  return updated || undefined;
}

export async function refreshNpcInRuntime(id: string): Promise<void> {
  const updated = await getNpcById(id);
  if (!updated) return;

  for (const map of Object.values(runtimeState.maps)) {
    // A map registered before its npcs were built (content import creates the
    // map document first) has no npcs bag yet.
    for (const [runtimeId, npc] of Object.entries(map.npcs ?? {})) {
      if ((npc.templateId ?? npc.id) === id) {
        const merged = {
          ...map.npcs[runtimeId]!,
          ...updated,
          // The document's id is the template's. The live npc answers to its
          // own, which is what replication, targeting and despawn know it by.
          id: npc.id,
          health: updated.maxHealth,
          action: CharacterAction.Idle,
        };
        // The spread cannot express removal, as with the $unset above: a
        // field the editor cleared is absent, and the live npc would keep the
        // old value until the next restart.
        for (const field of absentOptionalKeys(NpcSchema, updated)) {
          delete (merged as Record<string, unknown>)[field];
        }
        map.npcs[runtimeId] = merged;
        resetNpcAi(npc);
      }
    }
  }
}

export async function deleteNpc(id: string): Promise<void> {
  for (const map of Object.values(runtimeState.maps)) {
    // Keyed per spawn tile, not by the template they were built from.
    for (const npc of Object.values(map.npcs ?? {})) {
      if ((npc.templateId ?? npc.id) === id) despawnNpc(npc);
    }
  }
  await NpcModel.deleteOne({ id });
}

export async function listNpcs(): Promise<PersistentNpc[]> {
  return await NpcModel.find().lean<PersistentNpc[]>().exec();
}
