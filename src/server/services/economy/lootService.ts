// Rolling a loot table into concrete drops. A table expresses what a coin
// flip per item cannot: relative rarity, a bounded number of drops per
// kill, a drop that is always there, and a quantity range. Tables are
// shared, so retuning a tier is one edit rather than one per NPC.
//
// Pure over its input and driven by sim/rng, so a seed always produces the
// same loot, which replay and the determinism test depend on.

import { nextRandom, randomInt } from '../../sim/rng.js';
import type {
  LootEntry,
  LootQuantity,
  LootTable,
  NpcItemDrop,
} from '../../../shared/types.js';

export interface LootDrop {
  itemId: number;
  quantity: number;
}

function rollQuantity(quantity: LootQuantity | undefined): number {
  if (quantity === undefined) return 1;
  if (typeof quantity === 'number') return Math.max(1, Math.floor(quantity));

  const min = Math.max(1, Math.floor(quantity.min));
  const max = Math.max(min, Math.floor(quantity.max));
  return min + randomInt(max - min + 1);
}

/**
 * `chance` is 0..1 here, as content stores it. Not `rng.randomChance`,
 * which takes 0-100 and would make every drop a hundred times rarer.
 */
function rollChance(chance: number | undefined): boolean {
  if (chance === undefined) return true;
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  return nextRandom() < chance;
}

/**
 * One weighted draw. Returns undefined when the draw lands on `emptyWeight`,
 * which is a real outcome rather than a failure.
 */
function drawWeighted(
  entries: LootEntry[],
  emptyWeight: number,
): LootEntry | undefined {
  let total = emptyWeight;
  for (const entry of entries) total += weightOf(entry);
  if (total <= 0) return undefined;

  let ticket = nextRandom() * total;
  for (const entry of entries) {
    ticket -= weightOf(entry);
    if (ticket < 0) return entry;
  }
  // Fell through the entries, so the ticket belongs to the empty slot. Also
  // covers the floating-point edge where the ticket lands exactly on the total.
  return undefined;
}

function weightOf(entry: LootEntry): number {
  const weight = entry.weight ?? 1;
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

function rollCount(rolls: LootTable['rolls']): number {
  if (!rolls) return 1;
  const min = Math.max(0, Math.floor(rolls.min));
  const max = Math.max(min, Math.floor(rolls.max));
  return min + randomInt(max - min + 1);
}

/** Merges repeats so two draws of the same item land as one stack. */
function accumulate(drops: Map<number, number>, entry: LootEntry): void {
  const quantity = rollQuantity(entry.quantity);
  if (quantity <= 0) return;
  drops.set(entry.itemId, (drops.get(entry.itemId) ?? 0) + quantity);
}

/**
 * Rolls a table into the items it produced this time. Guaranteed entries
 * come first, then the weighted draws, so the rng calls for a table always
 * run in the same order and the result is reproducible from the seed.
 */
export function rollLootTable(table: LootTable): LootDrop[] {
  const drops = new Map<number, number>();

  for (const entry of table.guaranteed ?? []) {
    if (rollChance(entry.chance)) accumulate(drops, entry);
  }

  const entries = table.entries ?? [];
  if (entries.length > 0) {
    const draws = rollCount(table.rolls);
    const emptyWeight = Math.max(0, table.emptyWeight ?? 0);
    for (let i = 0; i < draws; i++) {
      const entry = drawWeighted(entries, emptyWeight);
      if (entry) accumulate(drops, entry);
    }
  }

  return [...drops].map(([itemId, quantity]) => ({ itemId, quantity }));
}

/**
 * Rolls the legacy per-item list.
 *
 * Kept as its own entry point rather than converted into a table, so the old
 * shape keeps its old semantics exactly: every entry is an independent coin
 * flip, and two entries for one item stack rather than compete.
 */
export function rollItemDrops(itemsToDrop: NpcItemDrop[]): LootDrop[] {
  const drops = new Map<number, number>();

  for (const drop of itemsToDrop) {
    if (!rollChance(drop.chance)) continue;
    accumulate(drops, { itemId: drop.itemId, quantity: drop.quantity });
  }

  return [...drops].map(([itemId, quantity]) => ({ itemId, quantity }));
}
