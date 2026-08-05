import { CharacterAction, PersistentNpc } from '../../../shared/types.js';
import { runtimeState } from '../world/gameData.js';
import NpcModel from '../../model/Npc.js';
import { getNextNpcId } from '../dbService.js';
import { resetNpcAi } from './aiBrain.js';
import { logger } from '../../logger.js';

export async function getNpcById(id: string): Promise<PersistentNpc | null> {
  return await NpcModel.findOne({ id }).lean<PersistentNpc>().exec();
}

export async function createOrUpdateNpc(
  npc: Partial<PersistentNpc>,
): Promise<void> {
  if (!npc.id) {
    npc.id = (await getNextNpcId()).toString();
  }

  await NpcModel.findOneAndUpdate({ id: npc.id }, npc, {
    upsert: true,
  });
}

/**
 * Optional references the editor can clear. The editor submits the whole
 * form, so a field left out was cleared, and `$set` only writes the keys
 * present: without an unset, a cleared field would seem to save and come
 * back on the next load.
 */
const CLEARABLE_NPC_FIELDS = [
  'lootTableId',
  'dialogId',
  'questId',
  'scriptId',
  'scriptParams',
] as const;

export async function updateNpcAll(
  id: string,
  updates: Partial<PersistentNpc>,
): Promise<PersistentNpc | undefined> {
  if (!id) return;

  const unset: Record<string, ''> = {};
  for (const field of CLEARABLE_NPC_FIELDS) {
    if (updates[field] === undefined) unset[field] = '';
  }

  const updated = await NpcModel.findOneAndUpdate(
    { id },
    {
      $set: updates,
      ...(Object.keys(unset).length > 0 && { $unset: unset }),
    },
    { new: true },
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
          health: updated.maxHealth,
          action: CharacterAction.Idle,
        };
        // The spread cannot express removal, for the same reason $unset exists
        // above: a field the editor cleared is absent from the document, so the
        // live npc would keep the old value until the next restart.
        for (const field of CLEARABLE_NPC_FIELDS) {
          if (updated[field] === undefined) delete merged[field];
        }
        map.npcs[runtimeId] = merged;
        resetNpcAi(npc);
      }
    }
  }
}

export async function deleteNpc(id: string): Promise<void> {
  await NpcModel.deleteOne({ id });
}

export async function listNpcs(): Promise<PersistentNpc[]> {
  return await NpcModel.find().lean<PersistentNpc[]>().exec();
}
