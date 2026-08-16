import type { NpcBehavior, Position } from '../../../shared/types.js';

export type NpcAiStateName = 'idle' | 'chase' | 'wander' | 'attack' | 'return';

export type NpcAiState = {
  state: NpcAiStateName;
  lastStateChangeTick: number;
  lastAttackTick: number;
  stuckTicks: number;
  /**
   * Where the npc stood the first time the ai saw it: the post it walks back
   * to once a chase ends. Kept here rather than on `RuntimeNpc` so it stays
   * off the wire, as no client reads it.
   */
  home: Position;
  /**
   * Player this npc is fighting because that player hit it. Survives outside
   * the sight radius and through walls, which is the whole point: it is the
   * only way an npc answers a blow it never saw coming.
   */
  aggroPlayerId?: string;
};

/** Behaviors that acquire and chase a target. The rest stand still. */
export const isHunter = (behavior: NpcBehavior): boolean =>
  behavior === 'aggressive' || behavior === 'hostile';
