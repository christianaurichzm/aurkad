import type {
  NpcBehavior,
  Position,
  RuntimeNpc,
} from '../../../shared/types.js';
import { msToTicks } from '../../sim/clock.js';
import { gameConfig } from '../../gameConfig.js';

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
   * the sight radius and through walls: it is the only way an npc answers a
   * blow it never saw coming.
   */
  aggroPlayerId?: string;
};

/** Behaviors that acquire and chase a target. The rest stand still. */
export const isHunter = (behavior: NpcBehavior): boolean =>
  behavior === 'aggressive' || behavior === 'hostile';

/**
 * Ticks between this npc's steps: how fast it is.
 *
 * Content sets it in milliseconds and the engine rounds up to a whole tick, so
 * the floor is one tick (50 ms at 20 Hz). Absent means the game-wide interval.
 */
export function npcMoveTicks(npc: RuntimeNpc): number {
  return Math.max(
    1,
    msToTicks(npc.moveIntervalMs ?? gameConfig.combat.npcUpdateIntervalMs),
  );
}
