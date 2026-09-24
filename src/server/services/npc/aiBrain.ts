import type { RuntimeNpc } from '../../../shared/types.js';
import { isHunter, type NpcAiState, type NpcAiStateName } from './types.js';
import { getTick } from '../../sim/clock.js';
import { getPlayerById } from '../../sim/world.js';

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
 *
 * Except while its target is within reach: whoever it is trading blows with
 * keeps it. Otherwise every arrow from the back of a party pulls it off the
 * player standing in front of it, and the fight turns into a chase.
 */
export function markNpcAggro(npc: RuntimeNpc, playerId: string) {
  if (!isHunter(npc.behavior)) return;

  const ai = getOrInitNpcAi(npc);
  // An npc walking back to its post is deaf. Otherwise a player
  // pulls it out again one arrow at a time and the leash buys nothing.
  if (ai.state === 'return') return;
  if (ai.aggroPlayerId !== playerId && withinReach(npc, ai.aggroPlayerId)) {
    return;
  }

  ai.aggroPlayerId = playerId;
}

function withinReach(npc: RuntimeNpc, playerId: string | undefined): boolean {
  const player = playerId ? getPlayerById(playerId) : undefined;
  return (
    !!player &&
    player.health > 0 &&
    player.mapId === npc.mapId &&
    Math.hypot(
      player.position.x - npc.position.x,
      player.position.y - npc.position.y,
    ) <= npc.attackRange
  );
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

/**
 * Drops the ai of everything on one map, for a map that stops existing.
 *
 * The key is `mapId:npcId`, so a closed instance leaves one entry per npc it
 * had, and nothing would ever come looking for them again.
 */
export function forgetNpcAiForMap(mapId: string) {
  const prefix = `${mapId}:`;
  for (const key of npcAiState.keys()) {
    if (key.startsWith(prefix)) npcAiState.delete(key);
  }
}

export function clearAllNpcAiState() {
  npcAiState.clear();
}
