import type { RuntimeNpc } from '../../../shared/types.js';
import type { NpcAiState, NpcAiStateName } from './types.js';
import { getTick } from '../../sim/clock.js';

const npcAiState = new Map<string, NpcAiState>();

function getNpcAiKey(npc: RuntimeNpc): string {
  return `${npc.mapId}:${npc.id}`;
}

export function getOrInitNpcAi(npc: RuntimeNpc): NpcAiState {
  const key = getNpcAiKey(npc);
  const existing = npcAiState.get(key);
  if (existing) return existing;

  const created: NpcAiState = {
    state: 'idle',
    lastStateChangeTick: getTick(),
    lastAttackTick: 0,
  };
  npcAiState.set(key, created);
  return created;
}

export function transitionNpcAi(ai: NpcAiState, next: NpcAiStateName) {
  if (ai.state === next) return;
  ai.state = next;
  ai.lastStateChangeTick = getTick();
}

export function resetNpcAi(npc: RuntimeNpc) {
  const key = getNpcAiKey(npc);
  npcAiState.delete(key);
}

export function clearAllNpcAiState() {
  npcAiState.clear();
}
