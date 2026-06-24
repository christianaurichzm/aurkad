export type NpcAiStateName = 'idle' | 'chase' | 'wander' | 'attack';

export type NpcAiState = {
  state: NpcAiStateName;
  lastStateChangeTick: number;
  lastAttackTick: number;
  stuckTicks: number;
};
