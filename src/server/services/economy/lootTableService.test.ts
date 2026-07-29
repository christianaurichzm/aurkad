/**
 * The loot table cache, read inside the tick on every npc death; these
 * cover that it tracks writes instead of going stale until a restart.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LootTable } from '../../../shared/types.js';

const stored: LootTable[] = [];
const findOneAndUpdate = vi.fn();
const deleteOne = vi.fn();

vi.mock('../../model/LootTable.js', () => ({
  default: {
    findOneAndUpdate: (...args: unknown[]) => {
      findOneAndUpdate(...args);
      return Promise.resolve(undefined);
    },
    deleteOne: (...args: unknown[]) => {
      deleteOne(...args);
      return Promise.resolve(undefined);
    },
    find: () => ({ lean: () => ({ exec: async () => stored }) }),
  },
}));

const {
  getLootTable,
  knownLootTableIds,
  loadLootTables,
  createOrUpdateLootTable,
  deleteLootTable,
  clearLootTableCache,
  cachedLootTables,
} = await import('./lootTableService.js');

const table = (id: string): LootTable => ({ id, name: `Table ${id}` });

beforeEach(() => {
  stored.length = 0;
  clearLootTableCache();
  findOneAndUpdate.mockClear();
  deleteOne.mockClear();
});

describe('loadLootTables', () => {
  it('fills the cache from the database', async () => {
    stored.push(table('a'), table('b'));

    await loadLootTables();

    expect(knownLootTableIds()).toEqual(new Set(['a', 'b']));
    expect(getLootTable('a')?.name).toBe('Table a');
  });

  it('replaces what was cached rather than merging into it', async () => {
    stored.push(table('a'));
    await loadLootTables();

    stored.length = 0;
    stored.push(table('b'));
    await loadLootTables();

    expect(getLootTable('a')).toBeUndefined();
    expect(getLootTable('b')).toBeDefined();
  });
});

describe('createOrUpdateLootTable', () => {
  // Otherwise an edit in the admin UI would not change a single drop until the
  // server was restarted.
  it('makes the new version visible without a reload', async () => {
    await createOrUpdateLootTable({
      id: 'a',
      name: 'First',
      guaranteed: [{ itemId: 1 }],
    });
    expect(getLootTable('a')?.guaranteed).toEqual([{ itemId: 1 }]);

    await createOrUpdateLootTable({
      id: 'a',
      name: 'Second',
      guaranteed: [{ itemId: 2 }],
    });

    expect(getLootTable('a')?.name).toBe('Second');
    expect(getLootTable('a')?.guaranteed).toEqual([{ itemId: 2 }]);
  });

  it('upserts by id', async () => {
    await createOrUpdateLootTable(table('a'));

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'a' },
      expect.objectContaining({ id: 'a' }),
      { upsert: true },
    );
  });

  it('does not alias the caller object into the cache', async () => {
    const original: LootTable = { id: 'a', name: 'A' };
    await createOrUpdateLootTable(original);
    original.name = 'mutated after save';

    expect(getLootTable('a')?.name).toBe('A');
  });
});

describe('deleteLootTable', () => {
  it('drops it from the cache too', async () => {
    await createOrUpdateLootTable(table('a'));
    await deleteLootTable('a');

    expect(getLootTable('a')).toBeUndefined();
    expect(deleteOne).toHaveBeenCalledWith({ id: 'a' });
  });
});

describe('knownLootTableIds', () => {
  it('is a copy, so a caller cannot corrupt the cache', async () => {
    await createOrUpdateLootTable(table('a'));
    knownLootTableIds().add('fake');

    expect(knownLootTableIds()).toEqual(new Set(['a']));
  });
});

describe('cachedLootTables', () => {
  it('lists what is loaded', async () => {
    await createOrUpdateLootTable(table('a'));
    await createOrUpdateLootTable(table('b'));

    expect(
      cachedLootTables()
        .map((t) => t.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});
