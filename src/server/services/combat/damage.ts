// Damage: normalizing a value, and remembering who dealt it.

import type { DamageContributor } from '../../../shared/types.js';

// Normalizes a damage value coming out of the beforeDamage hook.
// Scripts may set NaN, a negative or Infinity, so it clamps to a finite >= 0.
export function clampDamage(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Who damaged an entity and by how much, keyed by target id then player id.
 * The last hit is a poor proxy for who earned a kill, so the engine
 * measures this and leaves its worth to policy, sent out on `npcDeath`; the
 * party module splits experience its own way on `beforeXpGain`. Entries go
 * on death, respawn and despawn, and the size is published with the
 * cache_entries gauges, which catch a map keyed by id that only grows.
 */
const contributions = new Map<string, Map<string, number>>();

/** Adds to what `playerId` dealt to `targetId` since it was last cleared. */
export function recordDamageContribution(
  targetId: string,
  playerId: string,
  amount: number,
): void {
  if (!(amount > 0)) return;
  let byPlayer = contributions.get(targetId);
  if (!byPlayer) {
    byPlayer = new Map();
    contributions.set(targetId, byPlayer);
  }
  byPlayer.set(playerId, (byPlayer.get(playerId) ?? 0) + amount);
}

/** How much one player dealt to `targetId`, 0 if they never landed a hit. */
export function damageContributionOf(
  targetId: string,
  playerId: string,
): number {
  return contributions.get(targetId)?.get(playerId) ?? 0;
}

/** Every contributor, largest share first. Ties keep insertion order. */
export function damageContributors(targetId: string): DamageContributor[] {
  const byPlayer = contributions.get(targetId);
  if (!byPlayer) return [];
  return [...byPlayer]
    .map(([playerId, damage]) => ({ playerId, damage }))
    .sort((a, b) => b.damage - a.damage);
}

export function clearDamageContributions(targetId: string): void {
  contributions.delete(targetId);
}

/** Entities currently holding a ledger, published as a metric. */
export function damageLedgerSize(): number {
  return contributions.size;
}

/** Test seam, and the shutdown path for a world being torn down. */
export function clearAllDamageContributions(): void {
  contributions.clear();
}
