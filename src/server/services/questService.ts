import { PlayerServer } from '../../shared/types.js';
import { updatePlayer } from '../gameData.js';
import { sendCustomEvent } from './customEventService.js';
import { logger } from '../logger.js';

// Quest system: the engine tracks per-player progress (persisted in the
// data bag) and pushes the quest log to the client; games define the quests
// and their rewards. Definitions live in a registry (like commands);
// progress lives with the player. Mirrors the dialog split: mechanism here,
// content in scripts.

export interface QuestDef {
  id: string;
  name: string;
  description?: string;
  // Progress goal. Defaults to 1 (a do-once quest).
  target?: number;
  reward?: (player: PlayerServer) => void;
}

export interface QuestState {
  name: string;
  description: string;
  progress: number;
  target: number;
  status: 'active' | 'completed';
}

const defs = new Map<string, QuestDef>();

export function defineQuest(def: QuestDef): () => void {
  defs.set(def.id, def);
  return () => {
    if (defs.get(def.id) === def) defs.delete(def.id);
  };
}

function questBag(player: PlayerServer): Record<string, QuestState> {
  const data = (player.data ??= {});
  return (data.quests ??= {}) as Record<string, QuestState>;
}

function persist(player: PlayerServer): void {
  void updatePlayer(player).catch((e) =>
    logger.error('[quest] persist failed', { err: e }),
  );
}

function pushLog(player: PlayerServer): void {
  const quests = Object.entries(questBag(player)).map(([id, q]) => ({ id, ...q }));
  sendCustomEvent(player, 'quest:update', quests);
}

function finish(player: PlayerServer, id: string, q: QuestState): void {
  q.status = 'completed';
  const def = defs.get(id);
  try {
    def?.reward?.(player);
  } catch (e) {
    logger.error(`[quest] reward for "${id}" threw`, { err: e });
  }
}

// Returns false if the quest is undefined or the player already has it.
export function startQuest(player: PlayerServer, id: string): boolean {
  const def = defs.get(id);
  if (!def) return false;
  const bag = questBag(player);
  if (bag[id]) return false;

  bag[id] = {
    name: def.name,
    description: def.description ?? '',
    progress: 0,
    target: def.target ?? 1,
    status: 'active',
  };
  persist(player);
  pushLog(player);
  return true;
}

export function advanceQuest(player: PlayerServer, id: string, amount = 1): void {
  const q = questBag(player)[id];
  if (!q || q.status === 'completed') return;
  q.progress = Math.min(q.target, q.progress + amount);
  if (q.progress >= q.target) finish(player, id, q);
  persist(player);
  pushLog(player);
}

export function completeQuest(player: PlayerServer, id: string): void {
  const q = questBag(player)[id];
  if (!q || q.status === 'completed') return;
  q.progress = q.target;
  finish(player, id, q);
  persist(player);
  pushLog(player);
}

export function getQuest(player: PlayerServer, id: string): QuestState | undefined {
  return questBag(player)[id];
}

export function getQuests(player: PlayerServer): Record<string, QuestState> {
  return { ...questBag(player) };
}

// Test helper.
export function clearQuestDefs(): void {
  defs.clear();
}
