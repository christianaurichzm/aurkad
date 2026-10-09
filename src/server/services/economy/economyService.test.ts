/**
 * The economy funnel.
 *
 * Two things these lock down. First, every operation reports what happened, so
 * a full inventory cannot swallow an item and a removal cannot take less than
 * asked and report success. Second, items are conserved: a move either happens
 * on both sides or on neither.
 */
import { describe, it, expect } from 'vitest';
import {
  addItem,
  canFit,
  countItem,
  exchangeItems,
  hasItem,
  moveItem,
  removeItem,
} from './economyService.js';
import fc from 'fast-check';
import type { InventoryLike } from '../../../shared/types.js';

// The conservation check: an operation that claims to move items must
// leave this unchanged.
const totalItem = (containers: InventoryLike[], itemId: number): number =>
  containers.reduce((total, c) => total + countItem(c, itemId), 0);

const container = (
  items: Array<[number, number]> = [],
  maxCapacity = 5,
): InventoryLike => ({
  items: items.map(([item, quantity]) => ({ item, quantity })),
  maxCapacity,
});

describe('countItem', () => {
  it('returns the held quantity', () => {
    expect(countItem(container([[1, 7]]), 1)).toBe(7);
  });

  it('returns zero for an item not held', () => {
    expect(countItem(container([[1, 7]]), 2)).toBe(0);
  });

  // Residue from a bad removal is not a real holding.
  it('ignores a slot at zero', () => {
    expect(countItem(container([[1, 0]]), 1)).toBe(0);
  });

  it('ignores a slot gone negative', () => {
    expect(countItem(container([[1, -3]]), 1)).toBe(0);
  });
});

describe('hasItem', () => {
  it('is true for exactly the amount held', () => {
    expect(hasItem(container([[1, 3]]), 1, 3)).toBe(true);
  });

  it('is false for one more than held', () => {
    expect(hasItem(container([[1, 3]]), 1, 4)).toBe(false);
  });

  it('defaults to asking for one', () => {
    expect(hasItem(container([[1, 1]]), 1)).toBe(true);
    expect(hasItem(container(), 1)).toBe(false);
  });
});

describe('canFit', () => {
  it('is true when a stack is already held, even at capacity', () => {
    const full = container(
      [
        [1, 1],
        [2, 1],
      ],
      2,
    );
    expect(canFit(full, 1)).toBe(true);
  });

  it('is false for a new item at capacity', () => {
    const full = container(
      [
        [1, 1],
        [2, 1],
      ],
      2,
    );
    expect(canFit(full, 3)).toBe(false);
  });

  it('is true for a new item with a slot free', () => {
    expect(canFit(container([[1, 1]], 2), 3)).toBe(true);
  });

  // One rule for every feature (bank, shop, pickup): an empty slot does not
  // count against capacity.
  it('does not let an empty slot consume capacity', () => {
    const c = container(
      [
        [1, 0],
        [2, 1],
      ],
      2,
    );
    expect(canFit(c, 3)).toBe(true);
  });
});

describe('addItem', () => {
  it('creates a slot for a new item', () => {
    const c = container();
    expect(addItem(c, 1, 3)).toEqual({ ok: true });
    expect(c.items).toEqual([{ item: 1, quantity: 3 }]);
  });

  it('stacks onto an item already held', () => {
    const c = container([[1, 2]]);
    addItem(c, 1, 3);
    expect(c.items).toEqual([{ item: 1, quantity: 5 }]);
  });

  it('refuses a new item when every slot is taken', () => {
    const c = container(
      [
        [1, 1],
        [2, 1],
      ],
      2,
    );
    expect(addItem(c, 3)).toEqual({ ok: false, reason: 'no-space' });
    expect(c.items).toHaveLength(2);
  });

  it('still stacks at capacity, since a stack needs no new slot', () => {
    const c = container(
      [
        [1, 1],
        [2, 1],
      ],
      2,
    );
    expect(addItem(c, 1, 10)).toEqual({ ok: true });
    expect(countItem(c, 1)).toBe(11);
  });

  it('rejects a non-positive amount instead of corrupting the stack', () => {
    const c = container([[1, 5]]);
    expect(addItem(c, 1, 0)).toEqual({ ok: false, reason: 'invalid-amount' });
    expect(addItem(c, 1, -2)).toEqual({ ok: false, reason: 'invalid-amount' });
    expect(countItem(c, 1)).toBe(5);
  });

  it('rejects a fractional amount', () => {
    const c = container();
    expect(addItem(c, 1, 1.5)).toEqual({
      ok: false,
      reason: 'invalid-amount',
    });
    expect(c.items).toEqual([]);
  });
});

describe('removeItem', () => {
  it('subtracts from the stack', () => {
    const c = container([[1, 5]]);
    expect(removeItem(c, 1, 2)).toEqual({ ok: true });
    expect(countItem(c, 1)).toBe(3);
  });

  it('drops the slot when the stack empties', () => {
    const c = container([[1, 2]]);
    removeItem(c, 1, 2);
    expect(c.items).toEqual([]);
  });

  // Subtracting anyway would go negative, delete the slot and report
  // nothing, so asking for too much would destroy the rest.
  it('removes nothing when asked for more than is held', () => {
    const c = container([[1, 2]]);
    expect(removeItem(c, 1, 5)).toEqual({ ok: false, reason: 'not-enough' });
    expect(countItem(c, 1)).toBe(2);
  });

  it('fails for an item not held', () => {
    const c = container();
    expect(removeItem(c, 1)).toEqual({ ok: false, reason: 'not-enough' });
  });

  it('rejects a non-positive amount', () => {
    const c = container([[1, 5]]);
    expect(removeItem(c, 1, 0)).toEqual({
      ok: false,
      reason: 'invalid-amount',
    });
    expect(countItem(c, 1)).toBe(5);
  });

  it('leaves other slots alone', () => {
    const c = container([
      [1, 2],
      [2, 4],
    ]);
    removeItem(c, 1, 2);
    expect(c.items).toEqual([{ item: 2, quantity: 4 }]);
  });
});

describe('moveItem', () => {
  it('moves the amount across', () => {
    const from = container([[1, 5]]);
    const to = container();

    expect(moveItem(from, to, 1, 2)).toEqual({ ok: true });

    expect(countItem(from, 1)).toBe(3);
    expect(countItem(to, 1)).toBe(2);
  });

  // The reason this exists: remove-then-add would lose the item when the
  // destination turned out to be full.
  it('does not touch the source when the destination is full', () => {
    const from = container([[1, 5]]);
    const to = container(
      [
        [7, 1],
        [8, 1],
      ],
      2,
    );

    expect(moveItem(from, to, 1, 2)).toEqual({ ok: false, reason: 'no-space' });

    expect(countItem(from, 1)).toBe(5);
    expect(to.items).toHaveLength(2);
  });

  it('does not touch the destination when the source is short', () => {
    const from = container([[1, 1]]);
    const to = container();

    expect(moveItem(from, to, 1, 5)).toEqual({
      ok: false,
      reason: 'not-enough',
    });

    expect(countItem(from, 1)).toBe(1);
    expect(to.items).toEqual([]);
  });

  it('refuses to move a container into itself', () => {
    const c = container([[1, 5]]);
    expect(moveItem(c, c, 1, 2)).toEqual({
      ok: false,
      reason: 'same-container',
    });
    expect(countItem(c, 1)).toBe(5);
  });

  it('stacks into an existing slot on the destination', () => {
    const from = container([[1, 3]]);
    const to = container([[1, 4]]);

    moveItem(from, to, 1, 3);

    expect(from.items).toEqual([]);
    expect(countItem(to, 1)).toBe(7);
  });

  it('rejects a non-positive amount without moving anything', () => {
    const from = container([[1, 5]]);
    const to = container();

    expect(moveItem(from, to, 1, 0)).toEqual({
      ok: false,
      reason: 'invalid-amount',
    });
    expect(countItem(from, 1)).toBe(5);
    expect(to.items).toEqual([]);
  });
});

describe('exchangeItems', () => {
  it('consumes the inputs and produces the output', () => {
    const bag = container([
      [1, 2],
      [3, 60],
    ]);

    expect(
      exchangeItems(bag, [{ itemId: 3, quantity: 50 }], {
        itemId: 8,
        quantity: 1,
      }),
    ).toEqual({ ok: true });
    expect(countItem(bag, 3)).toBe(10);
    expect(countItem(bag, 8)).toBe(1);
  });

  // The reason this is one operation and not remove-then-add: the failure is
  // the ordinary case, and the naive order pays for a sword it never receives.
  it('leaves the inputs untouched when the output does not fit', () => {
    const bag = container(
      [
        [1, 1],
        [2, 1],
        [3, 60],
      ],
      3,
    );

    expect(
      exchangeItems(bag, [{ itemId: 3, quantity: 50 }], {
        itemId: 8,
        quantity: 1,
      }),
    ).toEqual({ ok: false, reason: 'no-space' });
    expect(countItem(bag, 3)).toBe(60);
    expect(countItem(bag, 8)).toBe(0);
  });

  // Asking canFit before the removals answers about the inventory as it is,
  // which refuses a craft that empties a slot to fill it.
  it('counts the slot an entirely consumed stack gives back', () => {
    const bag = container(
      [
        [1, 1],
        [2, 1],
        [3, 50],
      ],
      3,
    );

    expect(
      exchangeItems(bag, [{ itemId: 3, quantity: 50 }], {
        itemId: 8,
        quantity: 1,
      }),
    ).toEqual({ ok: true });
    expect(countItem(bag, 3)).toBe(0);
    expect(countItem(bag, 8)).toBe(1);
  });

  // 2 + 2 both fit a stack of 3 when checked one at a time; only summing first
  // gets the answer right, and getting it wrong here spends items for nothing.
  it('sums repeated ids instead of checking them one by one', () => {
    const bag = container([[3, 3]]);

    expect(
      exchangeItems(
        bag,
        [
          { itemId: 3, quantity: 2 },
          { itemId: 3, quantity: 2 },
        ],
        { itemId: 8, quantity: 1 },
      ),
    ).toEqual({ ok: false, reason: 'not-enough' });
    expect(countItem(bag, 3)).toBe(3);
  });

  it('takes the total when repeated ids do add up', () => {
    const bag = container([[3, 5]]);

    expect(
      exchangeItems(
        bag,
        [
          { itemId: 3, quantity: 2 },
          { itemId: 3, quantity: 2 },
        ],
        { itemId: 8, quantity: 1 },
      ),
    ).toEqual({ ok: true });
    expect(countItem(bag, 3)).toBe(1);
  });

  it('refuses when one of several inputs is short, taking none of them', () => {
    const bag = container([
      [2, 1],
      [3, 10],
    ]);

    expect(
      exchangeItems(
        bag,
        [
          { itemId: 2, quantity: 1 },
          { itemId: 3, quantity: 50 },
        ],
        { itemId: 8, quantity: 1 },
      ),
    ).toEqual({ ok: false, reason: 'not-enough' });
    expect(countItem(bag, 2)).toBe(1);
    expect(countItem(bag, 3)).toBe(10);
  });

  // A recipe that consumes nothing is an item printer; the funnel refuses it
  // even if a document somehow reaches here holding one.
  it('refuses an empty input list', () => {
    const bag = container([[3, 10]]);

    expect(exchangeItems(bag, [], { itemId: 8, quantity: 1 })).toEqual({
      ok: false,
      reason: 'invalid-amount',
    });
    expect(bag.items).toHaveLength(1);
  });

  it('refuses a non-positive quantity on either side', () => {
    const bag = container([[3, 10]]);

    expect(
      exchangeItems(bag, [{ itemId: 3, quantity: 0 }], {
        itemId: 8,
        quantity: 1,
      }),
    ).toEqual({ ok: false, reason: 'invalid-amount' });
    expect(
      exchangeItems(bag, [{ itemId: 3, quantity: 1 }], {
        itemId: 8,
        quantity: -1,
      }),
    ).toEqual({ ok: false, reason: 'invalid-amount' });
    expect(countItem(bag, 3)).toBe(10);
  });

  // Upgrading a stack in place: the output slot is one of the inputs, so it is
  // freed and refilled. A full bag must not turn that into a refusal.
  it('handles an output that is also an input', () => {
    const bag = container(
      [
        [1, 1],
        [3, 4],
      ],
      2,
    );

    expect(
      exchangeItems(bag, [{ itemId: 3, quantity: 4 }], {
        itemId: 3,
        quantity: 1,
      }),
    ).toEqual({ ok: true });
    expect(countItem(bag, 3)).toBe(1);
  });
});

describe('conservation', () => {
  it('totals one item across containers', () => {
    expect(
      totalItem([container([[1, 2]]), container([[1, 3]]), container()], 1),
    ).toBe(5);
  });

  // The invariants everything else rests on, checked against generated
  // states that reach what hand-picked ones miss (an empty container, a
  // stack equal to the request, a capacity of one); a failure shrinks to
  // the smallest counterexample.

  const slot = fc.record({
    item: fc.integer({ min: 1, max: 6 }),
    quantity: fc.integer({ min: 1, max: 20 }),
  });

  /** A container that is itself valid: never generated over capacity. */
  const anyContainer = fc
    .uniqueArray(slot, { maxLength: 5, selector: (s) => s.item })
    .chain((items) =>
      fc.record({
        items: fc.constant(items),
        maxCapacity: fc.integer({
          min: Math.max(1, items.length),
          max: items.length + 3,
        }),
      }),
    );

  const anyItemId = fc.integer({ min: 1, max: 6 });
  const anyAmount = fc.integer({ min: -2, max: 25 });

  const usedSlots = (c: InventoryLike) =>
    c.items.filter((s) => s.quantity > 0).length;

  it('moveItem never creates or destroys an item', () => {
    fc.assert(
      fc.property(
        anyContainer,
        anyContainer,
        anyItemId,
        anyAmount,
        (from, to, itemId, amount) => {
          const before = totalItem([from, to], itemId);

          moveItem(from, to, itemId, amount);

          expect(totalItem([from, to], itemId)).toBe(before);
        },
      ),
    );
  });

  it('moveItem leaves both sides untouched when it fails', () => {
    fc.assert(
      fc.property(
        anyContainer,
        anyContainer,
        anyItemId,
        anyAmount,
        (from, to, itemId, amount) => {
          const fromBefore = structuredClone(from);
          const toBefore = structuredClone(to);

          const result = moveItem(from, to, itemId, amount);

          fc.pre(!result.ok);
          expect(from).toEqual(fromBefore);
          expect(to).toEqual(toBefore);
        },
      ),
    );
  });

  it('moveItem moves exactly what it says when it succeeds', () => {
    fc.assert(
      fc.property(
        anyContainer,
        anyContainer,
        anyItemId,
        anyAmount,
        (from, to, itemId, amount) => {
          const fromBefore = countItem(from, itemId);
          const toBefore = countItem(to, itemId);

          const result = moveItem(from, to, itemId, amount);

          fc.pre(result.ok);
          expect(countItem(from, itemId)).toBe(fromBefore - amount);
          expect(countItem(to, itemId)).toBe(toBefore + amount);
        },
      ),
    );
  });

  it('no operation leaves a container over capacity or holding a dead stack', () => {
    fc.assert(
      fc.property(
        anyContainer,
        anyContainer,
        fc.array(
          fc.tuple(
            fc.constantFrom('move', 'add', 'remove'),
            anyItemId,
            anyAmount,
          ),
          { maxLength: 30 },
        ),
        (from, to, ops) => {
          for (const [op, itemId, amount] of ops) {
            if (op === 'move') moveItem(from, to, itemId, amount);
            else if (op === 'add') addItem(to, itemId, amount);
            else removeItem(from, itemId, amount);
          }

          for (const box of [from, to]) {
            expect(usedSlots(box)).toBeLessThanOrEqual(box.maxCapacity);
            for (const s of box.items) expect(s.quantity).toBeGreaterThan(0);
          }
        },
      ),
    );
  });

  // The loss this function exists to prevent: inputs consumed and no output.
  it('exchangeItems changes nothing at all when it fails', () => {
    fc.assert(
      fc.property(
        anyContainer,
        fc.array(fc.record({ itemId: anyItemId, quantity: anyAmount }), {
          minLength: 1,
          maxLength: 4,
        }),
        fc.record({ itemId: anyItemId, quantity: anyAmount }),
        (box, inputs, output) => {
          const before = structuredClone(box);

          const result = exchangeItems(box, inputs, output);

          fc.pre(!result.ok);
          expect(box).toEqual(before);
        },
      ),
    );
  });

  it('exchangeItems consumes every input exactly once, repeats included', () => {
    fc.assert(
      fc.property(
        anyContainer,
        fc.array(
          fc.record({
            itemId: anyItemId,
            quantity: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.record({
          itemId: anyItemId,
          quantity: fc.integer({ min: 1, max: 5 }),
        }),
        (box, inputs, output) => {
          const before = new Map<number, number>();
          for (const id of [1, 2, 3, 4, 5, 6])
            before.set(id, countItem(box, id));

          const result = exchangeItems(box, inputs, output);

          fc.pre(result.ok);
          // Two rows of the same id are one debt of their sum, which the
          // per-item tally in exchangeItems accounts for.
          const owed = new Map<number, number>();
          for (const i of inputs) {
            owed.set(i.itemId, (owed.get(i.itemId) ?? 0) + i.quantity);
          }
          for (const id of [1, 2, 3, 4, 5, 6]) {
            const produced = id === output.itemId ? output.quantity : 0;
            expect(countItem(box, id)).toBe(
              before.get(id)! - (owed.get(id) ?? 0) + produced,
            );
          }
        },
      ),
    );
  });
});
