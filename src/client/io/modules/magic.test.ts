import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The spellbook window of the shipped modules/magic/client.jsx; its slots on
// the hotbar are magicHotbar.test.ts.

const NOW = 1_700_000_000_000;

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  document.body.innerHTML = '';
  mod = loadClientModule('magic');
});

afterEach(() => {
  vi.useRealTimers();
});

const update = (payload: unknown) =>
  act(() => mod.handlers.get('magic:update')!(payload));
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;
const openWindow = () => act(() => mod.actions.get('Spells')!.click());
const spellButton = (name: RegExp) => screen.getByRole('button', { name });
const spellButtons = () =>
  within(screen.getByRole('list')).getAllByRole('button');

const spell = (over: Record<string, unknown> = {}) => ({
  id: 'arcane',
  name: 'Arcane',
  cost: 10,
  readyAt: 0,
  cooldownMs: 3000,
  ...over,
});
const STATE = {
  mana: 40,
  manaMax: 100,
  spells: [spell(), spell({ id: 'heal', name: 'Heal', cost: 30 })],
};

describe('the spells window', () => {
  it('asks the server for the spells on load', () => {
    expect(sent()).toContainEqual(['magic:request']);
  });

  it('opens from the Actions menu and closes on Escape', () => {
    openWindow();
    expect(screen.getByRole('dialog', { name: 'Spells' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the mana and each spell with what it does, costs and takes', () => {
    openWindow();
    update({
      ...STATE,
      spells: [
        spell({ description: 'Hurts.' }),
        spell({ id: 'heal', name: 'Heal', cost: 30, readyAt: NOW + 2100 }),
      ],
    });

    expect(screen.getByRole('dialog').textContent).toContain('Mana: 40/100');
    const [arcane, heal] = spellButtons().map((b) => b.textContent);
    expect(arcane).toBe('AArcaneHurts.10 MP3s cooldownF1');
    // Cooling down: the seconds left instead of the whole cooldown.
    expect(heal).toBe('HHeal30 MP3sF2');
  });

  it('lists the spells past F8, without a key', () => {
    openWindow();
    update({
      ...STATE,
      spells: Array.from({ length: 9 }, (_, i) =>
        spell({ id: `s${i}`, name: `S${i}` }),
      ),
    });

    const ninth = spellButtons()[8];
    expect(ninth.textContent).toContain('S8');
    expect(ninth.textContent).not.toContain('F9');
  });

  it('casts the spell clicked', () => {
    openWindow();
    update(STATE);

    fireEvent.click(spellButton(/Heal/));

    expect(sent()).toContainEqual(['spell:cast', { id: 'heal' }]);
  });

  it('disables a spell on cooldown or beyond the mana held', () => {
    openWindow();
    update({
      ...STATE,
      mana: 20,
      spells: [spell({ readyAt: NOW + 2000 }), spell({ id: 'heal', cost: 30 })],
    });

    for (const b of spellButtons()) {
      expect(b).toHaveProperty('disabled', true);
    }
  });

  it('enables a spell again when its cooldown ends between server pushes', () => {
    openWindow();
    update({ ...STATE, spells: [spell({ readyAt: NOW + 1200 })] });
    expect(spellButton(/Arcane/)).toHaveProperty('disabled', true);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(spellButton(/Arcane/)).toHaveProperty('disabled', false);
  });
});
