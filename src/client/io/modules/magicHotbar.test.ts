import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadClientModule,
  type LoadedClientModule,
} from '../../../test/clientModule';

// The slots the shipped modules/magic/client.jsx puts on the engine's hotbar;
// how the bar draws them is components/HUD/Hotbar.test.tsx.

const NOW = 1_700_000_000_000;

const spell = (over: Record<string, unknown> = {}) => ({
  id: 'arcane',
  name: 'Arcane',
  description: 'Hurts.',
  icon: 148,
  cost: 10,
  readyAt: 0,
  cooldownMs: 3000,
  ...over,
});

let mod: LoadedClientModule;

function push(state: unknown) {
  mod.handlers.get('magic:update')!(state);
}

const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mod = loadClientModule('magic');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('spell hotbar', () => {
  it('has no slots before the first magic update', () => {
    expect(mod.hotbar).toEqual([]);
  });

  it('puts each spell on a slot keyed F1, F2, ... with what the tooltip shows', () => {
    push({
      mana: 100,
      manaMax: 100,
      spells: [
        spell({ readyAt: NOW + 2000 }),
        spell({ id: 'heal', name: 'Heal', friendly: true, icon: undefined }),
      ],
    });

    expect(mod.hotbar).toMatchObject([
      {
        id: 'arcane',
        name: 'Arcane',
        description: 'Hurts.',
        key: 'F1',
        icon: 148,
        cost: 10,
        readyAt: NOW + 2000,
        cooldownMs: 3000,
        noMana: false,
      },
      { id: 'heal', key: 'F2', friendly: true, icon: undefined },
    ]);
  });

  it('marks a spell beyond the mana held', () => {
    push({ mana: 5, manaMax: 100, spells: [spell({ cost: 50 })] });

    expect(mod.hotbar[0]).toMatchObject({ noMana: true });
  });

  it('stops at eight slots; the rest are in the spellbook', () => {
    push({
      mana: 100,
      manaMax: 100,
      spells: Array.from({ length: 12 }, (_, i) =>
        spell({ id: `s${i}`, name: `S${i}` }),
      ),
    });

    expect(mod.hotbar.map((s) => s.key)).toEqual(
      Array.from({ length: 8 }, (_, i) => `F${i + 1}`),
    );
  });

  it('casts from a slot, unless the spell is cooling down or unaffordable', () => {
    push({
      mana: 20,
      manaMax: 100,
      spells: [
        spell(),
        spell({ id: 'late', readyAt: NOW + 1000 }),
        spell({ id: 'dear', cost: 50 }),
      ],
    });

    mod.hotbar.forEach((slot) => slot.onUse());

    expect(sent().filter(([channel]) => channel === 'spell:cast')).toEqual([
      ['spell:cast', { id: 'arcane' }],
    ]);
  });
});
