export type NpcAiStateName = 'idle' | 'chase' | 'wander' | 'attack';

export type NpcAiState = {
  state: NpcAiStateName;
  lastStateChangeMs: number;
  lastAttackMs: number;
};
