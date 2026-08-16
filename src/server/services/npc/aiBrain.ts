import type { RuntimeNpc } from '../../../shared/types.js';
import { isHunter, type NpcAiState, type NpcAiStateName } from './types.js';
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
    stuckTicks: 0,
    home: { ...npc.position },
  };
  npcAiState.set(key, created);
  return created;
}

/**
 * A hit is a target. Without this an archer (6 tiles by default) outranges
 * every hostile npc's notice radius (4) and kills it for free, and no npc ever
 * answers a blow struck from outside its sight or through a wall.
 */
export function markNpcAggro(npc: RuntimeNpc, playerId: string) {
  if (!isHunter(npc.behavior)) return;

  const ai = getOrInitNpcAi(npc);
  // An npc walking back to its post is deaf. Otherwise a player
  // pulls it out again one arrow at a time and the leash buys nothing.
  if (ai.state === 'return') return;

  ai.aggroPlayerId = playerId;
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
