import { CharacterAction, PersistentNpc } from '../../../shared/types.js';
import { runtimeState } from '../../gameData.js';
import NpcModel from '../../model/Npc.js';
import { getNextNpcId } from '../dbService.js';
import { resetNpcAi } from './aiBrain.js';

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

export async function updateNpcAll(
  id: string,
  updates: Partial<PersistentNpc>,
): Promise<PersistentNpc | undefined> {
  if (!id) return;

  const updated = await NpcModel.findOneAndUpdate(
    { id },
    { $set: updates },
    { new: true },
  )
    .lean<PersistentNpc>()
    .exec();

  refreshNpcInRuntime(id);

  return updated || undefined;
}

export async function refreshNpcInRuntime(id: string): Promise<void> {
  const updated = await getNpcById(id);
  if (!updated) return;

  for (const map of Object.values(runtimeState.maps)) {
    for (const [runtimeId, npc] of Object.entries(map.npcs)) {
      if (npc.id === id) {
        map.npcs[runtimeId] = {
          ...map.npcs[runtimeId]!,
          ...updated,
          health: updated.maxHealth,
          action: CharacterAction.Idle,
        };
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
