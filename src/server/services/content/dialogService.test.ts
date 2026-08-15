/**
 * The dialog cache, which keeps the interact path inside the tick free of a
 * DB round trip; these cover that it tracks writes instead of going stale
 * until a restart.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Dialog } from '../../../shared/types.js';

const stored: Dialog[] = [];
const findOneAndUpdate = vi.fn();
const deleteOne = vi.fn();

vi.mock('../../model/Dialog.js', () => ({
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
  getDialogById,
  knownDialogIds,
  loadDialogs,
  createOrUpdateDialog,
  deleteDialog,
  clearDialogCache,
  cachedDialogs,
} = await import('./dialogService.js');

const dialog = (id: string): Dialog => ({
  id,
  name: `Dialog ${id}`,
  nodes: [{ id: 'greet', text: 'Hello' }],
});

beforeEach(() => {
  stored.length = 0;
  clearDialogCache();
  findOneAndUpdate.mockClear();
  deleteOne.mockClear();
});

describe('loadDialogs', () => {
  it('fills the cache from the database', async () => {
    stored.push(dialog('a'), dialog('b'));

    await loadDialogs();

    expect(knownDialogIds()).toEqual(new Set(['a', 'b']));
    expect(getDialogById('a')?.name).toBe('Dialog a');
  });

  it('replaces what was cached rather than merging into it', async () => {
    stored.push(dialog('a'));
    await loadDialogs();

    stored.length = 0;
    stored.push(dialog('b'));
    await loadDialogs();

    expect(getDialogById('a')).toBeUndefined();
    expect(getDialogById('b')).toBeDefined();
  });
});

describe('createOrUpdateDialog', () => {
  // Otherwise an edit in the editor would not change a word of what the npc
  // says until the server was restarted.
  it('makes the new version visible without a reload', async () => {
    await createOrUpdateDialog(dialog('a'));
    await createOrUpdateDialog({
      id: 'a',
      name: 'Rewritten',
      nodes: [{ id: 'greet', text: 'Go away' }],
    });

    expect(getDialogById('a')?.name).toBe('Rewritten');
    expect(getDialogById('a')?.nodes[0]?.text).toBe('Go away');
  });

  it('upserts by id', async () => {
    await createOrUpdateDialog(dialog('a'));

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'a' },
      expect.objectContaining({ id: 'a' }),
      { upsert: true },
    );
  });

  // Deep, not shallow: the nodes are where the text lives, and an aliased node
  // would let the caller rewrite what the npc says after the save.
  it('does not alias the caller nodes into the cache', async () => {
    const original = dialog('a');
    await createOrUpdateDialog(original);
    original.nodes[0]!.text = 'mutated after save';

    expect(getDialogById('a')?.nodes[0]?.text).toBe('Hello');
  });
});

describe('deleteDialog', () => {
  it('drops it from the cache too', async () => {
    await createOrUpdateDialog(dialog('a'));
    await deleteDialog('a');

    expect(getDialogById('a')).toBeUndefined();
    expect(deleteOne).toHaveBeenCalledWith({ id: 'a' });
  });
});

describe('knownDialogIds', () => {
  it('is a copy, so a caller cannot corrupt the cache', async () => {
    await createOrUpdateDialog(dialog('a'));
    knownDialogIds().add('fake');

    expect(knownDialogIds()).toEqual(new Set(['a']));
  });
});

describe('cachedDialogs', () => {
  it('lists what is loaded', async () => {
    await createOrUpdateDialog(dialog('a'));
    await createOrUpdateDialog(dialog('b'));

    expect(
      cachedDialogs()
        .map((d) => d.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});
