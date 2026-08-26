// Single funnel for moving items between containers.
//
// Every operation answers whether it happened and why not, and every
// multi-step move checks both sides before touching either, so a transfer
// cannot half-apply and a failed move never creates or destroys an item.
// Mail, crafting and fraud reconciliation rest on that.
//
// Synchronous and pure over the containers it is handed. "Check then act"
// is atomic because nothing yields in between; an await inside one of
// these would break that.

import type { InventoryLike } from '../../../shared/types.js';

export type EconomyFailure =
  'invalid-amount' | 'not-enough' | 'no-space' | 'same-container';

export type EconomyResult =
  { ok: true } | { ok: false; reason: EconomyFailure };

const OK: EconomyResult = { ok: true };
const fail = (reason: EconomyFailure): EconomyResult => ({ ok: false, reason });

function isValidAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0 && Number.isInteger(amount);
}

/**
 * Slots actually in use. A slot at zero or below is residue from a bad
 * removal, not a real one, so it never costs the player capacity.
 */
function usedSlots(container: InventoryLike): number {
  let used = 0;
  for (const slot of container.items) if (slot.quantity > 0) used++;
  return used;
}

function findSlot(container: InventoryLike, itemId: number) {
  return container.items.find(
    (slot) => Number(slot.item) === Number(itemId) && slot.quantity > 0,
  );
}

export function countItem(container: InventoryLike, itemId: number): number {
  return findSlot(container, itemId)?.quantity ?? 0;
}

export function hasItem(
  container: InventoryLike,
  itemId: number,
  amount = 1,
): boolean {
  return countItem(container, itemId) >= amount;
}

/**
 * Whether the item can be added at all. Stacks are unbounded, so an item
 * already held always fits and a new one needs a free slot. Amount does not
 * enter into it, which makes a partial add impossible.
 */
export function canFit(container: InventoryLike, itemId: number): boolean {
  if (findSlot(container, itemId)) return true;
  return usedSlots(container) < container.maxCapacity;
}

export function addItem(
  container: InventoryLike,
  itemId: number,
  amount = 1,
): EconomyResult {
  if (!isValidAmount(amount)) return fail('invalid-amount');

  const slot = findSlot(container, itemId);
  if (slot) {
    slot.quantity += amount;
    return OK;
  }

  if (usedSlots(container) >= container.maxCapacity) return fail('no-space');
  container.items.push({ item: itemId, quantity: amount });
  return OK;
}

/**
 * Removes the full amount or nothing.
 *
 * The all-or-nothing part is the fix: the previous version subtracted whatever
 * it was asked for, went negative, deleted the slot and told the caller
 * nothing, so asking for more than the player had quietly destroyed the rest.
 */
export function removeItem(
  container: InventoryLike,
  itemId: number,
  amount = 1,
): EconomyResult {
  if (!isValidAmount(amount)) return fail('invalid-amount');

  const slot = findSlot(container, itemId);
  if (!slot || slot.quantity < amount) return fail('not-enough');

  slot.quantity -= amount;
  if (slot.quantity <= 0) {
    container.items = container.items.filter((entry) => entry !== slot);
  }
  return OK;
}

/**
 * Moves an item between containers, or does nothing. Both sides are checked
 * before either is touched, so a full destination never consumes the source.
 */
export function moveItem(
  from: InventoryLike,
  to: InventoryLike,
  itemId: number,
  amount = 1,
): EconomyResult {
  if (!isValidAmount(amount)) return fail('invalid-amount');
  if (from === to) return fail('same-container');
  if (!hasItem(from, itemId, amount)) return fail('not-enough');
  if (!canFit(to, itemId)) return fail('no-space');

  const removed = removeItem(from, itemId, amount);
  if (!removed.ok) return removed;
  const added = addItem(to, itemId, amount);
  if (!added.ok) {
    // Unreachable given the checks above, but putting it back beats losing it
    // if a future edit breaks one of them.
    addItem(from, itemId, amount);
    return added;
  }
  return OK;
}

export interface ItemAmount {
  itemId: number;
  quantity: number;
}

/**
 * Consumes several items and produces one, or changes nothing. `removeItem`
 * per input then `addItem` robs the player whenever the last step fails,
 * which a full bag makes the ordinary case.
 *
 * Two things a naive check gets wrong, both refusing a craft that works:
 *
 * - Repeated ids. Two rows of 2 both pass `hasItem(3)` against a stack of
 *   3, so amounts are summed per item before anything is compared.
 * - Slots the inputs give back. A full bag spending its whole stack of ore
 *   frees that slot for the sword, so capacity is judged on the bag after
 *   consumption, not before.
 */
export function exchangeItems(
  container: InventoryLike,
  inputs: ItemAmount[],
  output: ItemAmount,
): EconomyResult {
  if (inputs.length === 0) return fail('invalid-amount');
  if (!isValidAmount(output.quantity)) return fail('invalid-amount');

  const required = new Map<number, number>();
  for (const input of inputs) {
    if (!isValidAmount(input.quantity)) return fail('invalid-amount');
    const itemId = Number(input.itemId);
    required.set(itemId, (required.get(itemId) ?? 0) + input.quantity);
  }

  // How many slots the consumption empties: a stack taken down to zero is a
  // slot back, and only a stack taken in full frees one.
  let freedSlots = 0;
  for (const [itemId, amount] of required) {
    const held = countItem(container, itemId);
    if (held < amount) return fail('not-enough');
    if (held === amount) freedSlots++;
  }

  const outputId = Number(output.itemId);
  const outputSurvives =
    countItem(container, outputId) > (required.get(outputId) ?? 0);
  if (
    !outputSurvives &&
    usedSlots(container) - freedSlots >= container.maxCapacity
  ) {
    return fail('no-space');
  }

  // Both failure paths below are unreachable given the checks above, but
  // they put back what was taken: half a consumed recipe is the exact loss
  // this function exists to prevent.
  const taken: ItemAmount[] = [];
  const restore = () => {
    for (const entry of taken) addItem(container, entry.itemId, entry.quantity);
  };

  for (const [itemId, quantity] of required) {
    const removed = removeItem(container, itemId, quantity);
    if (!removed.ok) {
      restore();
      return removed;
    }
    taken.push({ itemId, quantity });
  }

  const added = addItem(container, outputId, output.quantity);
  if (!added.ok) {
    restore();
    return added;
  }
  return OK;
}

/**
 * Total of one item across containers.
 *
 * The conservation check: an operation that claims to move items must leave
 * this unchanged. Property tests use it, and it is what a reconciliation job
 * would compare snapshots of.
 */
export function totalItem(containers: InventoryLike[], itemId: number): number {
  let total = 0;
  for (const container of containers) total += countItem(container, itemId);
  return total;
}
