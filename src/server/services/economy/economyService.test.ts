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
  hasItem,
  moveItem,
  removeItem,
  totalItem,
} from './economyService.js';
import { seedRng, randomInt } from '../../sim/rng.js';
import type { InventoryLike } from '../../../shared/types.js';

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

describe('conservation', () => {
  it('totals one item across containers', () => {
    expect(
      totalItem([container([[1, 2]]), container([[1, 3]]), container()], 1),
    ).toBe(5);
  });

  // The invariant everything else is built on. Random moves, valid and
  // invalid, must never change how many of an item exist.
  it('never creates or destroys items across a long run of random moves', () => {
    seedRng(7);

    const boxes = [
      container(
        [
          [1, 10],
          [2, 4],
        ],
        4,
      ),
      container([[1, 6]], 3),
      container([], 2),
      container([[2, 1]], 1),
    ];

    const before1 = totalItem(boxes, 1);
    const before2 = totalItem(boxes, 2);

    for (let i = 0; i < 3000; i++) {
      const from = boxes[randomInt(boxes.length)]!;
      const to = boxes[randomInt(boxes.length)]!;
      const itemId = 1 + randomInt(3);
      // Includes amounts nobody holds and destinations with no room, so the
      // failure paths are exercised as hard as the happy one.
      const amount = 1 + randomInt(8);

      moveItem(from, to, itemId, amount);

      expect(totalItem(boxes, 1)).toBe(before1);
      expect(totalItem(boxes, 2)).toBe(before2);
    }
  });

  it('never leaves a container over capacity', () => {
    seedRng(11);

    const boxes = [container([[1, 20]], 3), container([], 1), container([], 2)];

    for (let i = 0; i < 2000; i++) {
      const from = boxes[randomInt(boxes.length)]!;
      const to = boxes[randomInt(boxes.length)]!;
      moveItem(from, to, 1 + randomInt(5), 1 + randomInt(4));

      for (const box of boxes) {
        const used = box.items.filter((s) => s.quantity > 0).length;
        expect(used).toBeLessThanOrEqual(box.maxCapacity);
      }
    }
  });

  it('never leaves a negative stack', () => {
    seedRng(3);
    const c = container([[1, 5]]);

    for (let i = 0; i < 500; i++) {
      removeItem(c, 1, 1 + randomInt(10));
      addItem(c, 1, 1 + randomInt(3));
      for (const slot of c.items) expect(slot.quantity).toBeGreaterThan(0);
    }
  });
});
