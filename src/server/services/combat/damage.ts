// Damage: normalizing a value, and remembering who dealt it.

import type { DamageContributor } from '../../../shared/types.js';

// Normalizes a damage value coming out of the beforeDamage hook.
// Scripts may set NaN, a negative or Infinity, so it clamps to a finite >= 0.
export function clampDamage(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Who damaged an entity and by how much, keyed by target id then player id.
 *
 * Kept because the last hit is a bad proxy for who earned the kill: whoever
 * fought a boss for a minute and whoever tapped it as it fell are
 * indistinguishable to `attacker` alone. The engine only *measures* this -
 * deciding what it is worth is policy, and policy lives in a hook (ADR-0012),
 * which is why the numbers travel out on `npcDeath` instead of being spent
 * here. The party module already splits experience its own way on
 * `beforeXpGain`; core doing a second, different split would fight it.
 *
 * Entries are removed on death, respawn and despawn. A map keyed by entity id
 * that only ever grows is the shape of leak the cache_entries gauges exist to
 * catch, so this one is published alongside them.
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
