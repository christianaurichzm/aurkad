import { msToTicks } from '../../sim/clock.js';
import { PLAYER_ATTACK_COOLDOWN_MS } from '../../../shared/constants.js';

const lastAttackTick = new Map<string, number>();

export function tryConsumeAttackCooldown(id: string, tick: number): boolean {
  const last = lastAttackTick.get(id);
  if (
    last !== undefined &&
    tick - last < msToTicks(PLAYER_ATTACK_COOLDOWN_MS)
  ) {
    return false;
  }
  lastAttackTick.set(id, tick);
  return true;
}

export function clearAttackCooldown(id: string): void {
  lastAttackTick.delete(id);
}

export function clearAllAttackCooldowns(): void {
  lastAttackTick.clear();
}
