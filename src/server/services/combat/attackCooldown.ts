import { msToTicks } from '../../sim/clock.js';
import { gameConfig } from '../../gameConfig.js';

const lastAttackTick = new Map<string, number>();

export function tryConsumeAttackCooldown(id: string, tick: number): boolean {
  const last = lastAttackTick.get(id);
  if (
    last !== undefined &&
    tick - last < msToTicks(gameConfig.combat.playerAttackCooldownMs)
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
