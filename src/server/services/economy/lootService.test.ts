/**
 * Every test seeds the rng first: a replay only reproduces a session if
 * every roll that affects the world comes from that sequence. Distribution
 * tests use a large sample against a wide band, checking that the weights
 * mean what they say rather than pinning a sequence any rng change breaks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { rollLootTable } from './lootService.js';
import { seedRng } from '../../sim/rng.js';
import type { LootTable } from '../../../shared/types.js';

beforeEach(() => {
  seedRng(12345);
});

/** Rolls `times` and returns how often each item id appeared. */
function frequency(table: LootTable, times: number): Map<number, number> {
  const seen = new Map<number, number>();
  for (let i = 0; i < times; i++) {
    for (const drop of rollLootTable(table)) {
      seen.set(drop.itemId, (seen.get(drop.itemId) ?? 0) + 1);
    }
  }
  return seen;
}

describe('guaranteed entries', () => {
  it('always drops an entry with no chance set', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [{ itemId: 1 }],
    };

    for (let i = 0; i < 50; i++) {
      expect(rollLootTable(table)).toEqual([{ itemId: 1, quantity: 1 }]);
    }
  });

  it('always drops at chance 1', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [{ itemId: 1, chance: 1 }],
    };
    expect(frequency(table, 200).get(1)).toBe(200);
  });

  it('never drops at chance 0', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [{ itemId: 1, chance: 0 }],
    };
    expect(frequency(table, 200).get(1)).toBeUndefined();
  });

  // chance is 0..1 here; read as the 0-100 rng.randomChance takes, every
  // drop would be a hundred times rarer than configured.
  it('treats chance as a fraction, not a percentage', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [{ itemId: 1, chance: 0.5 }],
    };

    const hits = frequency(table, 4000).get(1) ?? 0;
    expect(hits / 4000).toBeGreaterThan(0.45);
    expect(hits / 4000).toBeLessThan(0.55);
  });

  it('rolls each guaranteed entry independently', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [
        { itemId: 1, chance: 1 },
        { itemId: 2, chance: 0 },
        { itemId: 3, chance: 1 },
      ],
    };

    expect(
      rollLootTable(table)
        .map((d) => d.itemId)
        .sort(),
    ).toEqual([1, 3]);
  });
});

describe('weighted entries', () => {
  it('draws exactly one by default', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      entries: [{ itemId: 1 }, { itemId: 2 }],
    };

    for (let i = 0; i < 50; i++) {
      const drops = rollLootTable(table);
      expect(drops).toHaveLength(1);
    }
  });

  it('respects relative weight', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      entries: [
        { itemId: 1, weight: 30 },
        { itemId: 2, weight: 10 },
      ],
    };

    const seen = frequency(table, 4000);
    const ratio = (seen.get(1) ?? 0) / (seen.get(2) ?? 1);
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });

  it('treats a missing weight as 1', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      entries: [{ itemId: 1 }, { itemId: 2, weight: 1 }],
    };

    const seen = frequency(table, 4000);
    const ratio = (seen.get(1) ?? 0) / (seen.get(2) ?? 1);
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it('never draws a zero-weight entry', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      entries: [
        { itemId: 1, weight: 0 },
        { itemId: 2, weight: 5 },
      ],
    };

    expect(frequency(table, 500).get(1)).toBeUndefined();
  });

  it('draws the configured number of times', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      rolls: { min: 3, max: 3 },
      entries: [{ itemId: 1 }],
    };

    // Three draws of one item merge into a single stack of three.
    expect(rollLootTable(table)).toEqual([{ itemId: 1, quantity: 3 }]);
  });

  it('varies the draw count across the range', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      rolls: { min: 1, max: 3 },
      entries: [{ itemId: 1 }],
    };

    const counts = new Set<number>();
    for (let i = 0; i < 200; i++) {
      counts.add(rollLootTable(table)[0]?.quantity ?? 0);
    }
    expect([...counts].sort()).toEqual([1, 2, 3]);
  });

  it('drops nothing when rolls is zero', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      rolls: { min: 0, max: 0 },
      entries: [{ itemId: 1 }],
    };

    expect(rollLootTable(table)).toEqual([]);
  });

  // How a pool says "usually nothing" without inventing a placeholder item.
  it('can draw nothing via emptyWeight', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      entries: [{ itemId: 1, weight: 1 }],
      emptyWeight: 9,
    };

    const hits = frequency(table, 4000).get(1) ?? 0;
    expect(hits / 4000).toBeGreaterThan(0.05);
    expect(hits / 4000).toBeLessThan(0.15);
  });
});

describe('quantity', () => {
  it('defaults to one', () => {
    expect(
      rollLootTable({ id: 't', name: 'T', guaranteed: [{ itemId: 1 }] }),
    ).toEqual([{ itemId: 1, quantity: 1 }]);
  });

  it('uses a fixed number as given', () => {
    expect(
      rollLootTable({
        id: 't',
        name: 'T',
        guaranteed: [{ itemId: 1, quantity: 7 }],
      }),
    ).toEqual([{ itemId: 1, quantity: 7 }]);
  });

  it('rolls inside a range, inclusive of both ends', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [{ itemId: 1, quantity: { min: 3, max: 7 } }],
    };

    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      seen.add(rollLootTable(table)[0]!.quantity);
    }
    expect(Math.min(...seen)).toBe(3);
    expect(Math.max(...seen)).toBe(7);
  });

  it('survives a range given backwards', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [{ itemId: 1, quantity: { min: 9, max: 2 } }],
    };
    expect(rollLootTable(table)[0]!.quantity).toBe(9);
  });
});

describe('determinism', () => {
  it('produces the same loot from the same seed', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [{ itemId: 1, chance: 0.5 }],
      rolls: { min: 1, max: 4 },
      entries: [
        { itemId: 2, weight: 3 },
        { itemId: 3, weight: 1, quantity: { min: 1, max: 5 } },
      ],
    };

    seedRng(999);
    const first = Array.from({ length: 20 }, () => rollLootTable(table));
    seedRng(999);
    const second = Array.from({ length: 20 }, () => rollLootTable(table));

    expect(second).toEqual(first);
  });

  it('produces different loot from a different seed', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      rolls: { min: 1, max: 6 },
      entries: [{ itemId: 1 }, { itemId: 2 }, { itemId: 3 }],
    };

    seedRng(1);
    const a = Array.from({ length: 20 }, () => rollLootTable(table));
    seedRng(2);
    const b = Array.from({ length: 20 }, () => rollLootTable(table));

    expect(b).not.toEqual(a);
  });
});

describe('degenerate tables', () => {
  it('drops nothing for an empty table', () => {
    expect(rollLootTable({ id: 't', name: 'T' })).toEqual([]);
  });

  it('drops nothing when every entry has zero weight and there is no empty slot', () => {
    expect(
      rollLootTable({
        id: 't',
        name: 'T',
        entries: [{ itemId: 1, weight: 0 }],
      }),
    ).toEqual([]);
  });

  it('combines guaranteed and weighted parts', () => {
    const table: LootTable = {
      id: 't',
      name: 'T',
      guaranteed: [{ itemId: 99, chance: 1 }],
      entries: [{ itemId: 1 }],
    };

    expect(
      rollLootTable(table)
        .map((d) => d.itemId)
        .sort(),
    ).toEqual([1, 99]);
  });
});
