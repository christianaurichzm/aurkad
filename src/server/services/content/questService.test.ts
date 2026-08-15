/**
 * The quest cache, read from four hooks inside the tick; these cover that
 * it tracks writes instead of going stale until a restart.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Quest } from '../../../shared/types.js';

const stored: Quest[] = [];
const findOneAndUpdate = vi.fn();
const deleteOne = vi.fn();

vi.mock('../../model/Quest.js', () => ({
  default: {
    findOneAndUpdate: (...args: unknown[]) => {
      findOneAndUpdate(...args);
      return Promise.resolve(undefined);
    },
    deleteOne: (...args: unknown[]) => {
      deleteOne(...args);
      return Promise.resolve(undefined);
    },
    find: () => ({ lean: () => ({ exec: () => Promise.resolve(stored) }) }),
  },
}));

const {
  getQuestById,
  knownQuestIds,
  loadQuests,
  createOrUpdateQuest,
  deleteQuest,
  clearQuestCache,
  cachedQuests,
} = await import('./questService.js');

const quest = (id: string): Quest => ({
  id,
  name: `Quest ${id}`,
  objective: { type: 'kill', npcId: 'goblin', count: 3 },
});

beforeEach(() => {
  stored.length = 0;
  clearQuestCache();
  findOneAndUpdate.mockClear();
  deleteOne.mockClear();
});

describe('loadQuests', () => {
  it('fills the cache from the database', async () => {
    stored.push(quest('a'), quest('b'));

    await loadQuests();

    expect(knownQuestIds()).toEqual(new Set(['a', 'b']));
    expect(getQuestById('a')?.name).toBe('Quest a');
  });

  it('replaces what was cached rather than merging into it', async () => {
    stored.push(quest('a'));
    await loadQuests();

    stored.length = 0;
    stored.push(quest('b'));
    await loadQuests();

    expect(getQuestById('a')).toBeUndefined();
    expect(getQuestById('b')).toBeDefined();
  });
});

describe('createOrUpdateQuest', () => {
  // Otherwise raising a kill count in the editor would leave every player
  // chasing the old one until the server was restarted.
  it('makes the new version visible without a reload', async () => {
    await createOrUpdateQuest(quest('a'));
    await createOrUpdateQuest({
      id: 'a',
      name: 'Rewritten',
      objective: { type: 'kill', npcId: 'orc', count: 10 },
    });

    expect(getQuestById('a')?.name).toBe('Rewritten');
    expect(getQuestById('a')?.objective).toEqual({
      type: 'kill',
      npcId: 'orc',
      count: 10,
    });
  });

  it('upserts by id', async () => {
    await createOrUpdateQuest(quest('a'));

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'a' },
      expect.objectContaining({ id: 'a' }),
      { upsert: true },
    );
  });

  // Deep, not shallow: the objective is a nested object, and an aliased one
  // would let the caller change what the quest asks for after the save.
  it('does not alias the caller objective into the cache', async () => {
    const original = quest('a');
    await createOrUpdateQuest(original);
    (original.objective as { count: number }).count = 999;

    expect(
      (getQuestById('a')?.objective as { count: number } | undefined)?.count,
    ).toBe(3);
  });
});

describe('deleteQuest', () => {
  it('drops it from the cache too', async () => {
    await createOrUpdateQuest(quest('a'));
    await deleteQuest('a');

    expect(getQuestById('a')).toBeUndefined();
    expect(deleteOne).toHaveBeenCalledWith({ id: 'a' });
  });
});

describe('knownQuestIds', () => {
  it('is a copy, so a caller cannot corrupt the cache', async () => {
    await createOrUpdateQuest(quest('a'));
    knownQuestIds().add('fake');

    expect(knownQuestIds()).toEqual(new Set(['a']));
  });
});

describe('cachedQuests', () => {
  it('lists what is loaded', async () => {
    await createOrUpdateQuest(quest('a'));
    await createOrUpdateQuest(quest('b'));

    expect(
      cachedQuests()
        .map((q) => q.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});
