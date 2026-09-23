/**
 * What a spell has to be to get written. The scripting API writes spells as
 * well as the route, so a bad value is refused before the database,
 * whoever sent it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Spell } from '../../../shared/types.js';

const findOneAndUpdate = vi.fn();

vi.mock('../../model/Spell.js', () => ({
  default: {
    findOneAndUpdate: (filter: unknown, doc: unknown, opts: unknown) => {
      findOneAndUpdate(filter, doc, opts);
      return { lean: () => ({ exec: () => Promise.resolve(doc as Spell) }) };
    },
    findOne: () => ({
      sort: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
    }),
  },
}));

const { createOrUpdateSpell, getSpellSync } = await import('./spellService.js');

const spell = (over: Record<string, unknown> = {}) => ({
  name: 'Fireball',
  sprite: 1,
  ...over,
});

beforeEach(() => findOneAndUpdate.mockClear());

describe('createOrUpdateSpell', () => {
  it('writes a valid spell, filling in what the caller left out', async () => {
    await createOrUpdateSpell(spell({ id: 7, damage: 12 }));

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { id: 7 },
      {
        id: 7,
        name: 'Fireball',
        description: '',
        sprite: 1,
        mpCost: 0,
        damage: 12,
        cooldownMs: 0,
        target: 'enemies',
        heal: 0,
        frames: 1,
        visualTarget: 'self',
      },
      { upsert: true, new: true },
    );
    expect(getSpellSync(7)?.damage).toBe(12);
  });

  it('refuses a negative number and says which field', async () => {
    await expect(createOrUpdateSpell(spell({ damage: -50 }))).rejects.toThrow(
      /damage/,
    );

    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  // What the script API produces from a missing field: `Number(undefined)`.
  it('refuses NaN', async () => {
    await expect(createOrUpdateSpell(spell({ mpCost: NaN }))).rejects.toThrow(
      /mpCost/,
    );

    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses a spell with no name', async () => {
    await expect(createOrUpdateSpell(spell({ name: '' }))).rejects.toThrow(
      /name/,
    );

    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('drops fields the spell document does not have', async () => {
    await createOrUpdateSpell(spell({ id: 3, wat: 'nonsense' }));

    const [, doc] = findOneAndUpdate.mock.calls[0] as [unknown, object];
    expect(doc).not.toHaveProperty('wat');
  });
});
