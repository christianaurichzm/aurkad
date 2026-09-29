import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The Spells window of the shipped modules/magic/client.jsx; the hotbar drawn
// on the canvas is magicHotbar.test.ts.

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

  it('shows the mana and each spell with its key and cost', () => {
    openWindow();
    update(STATE);

    expect(screen.getByRole('dialog').textContent).toContain('Mana: 40/100');
    expect(spellButton(/^F1 · Arcane \(10\)$/)).toBeTruthy();
    expect(spellButton(/^F2 · Heal \(30\)$/)).toBeTruthy();
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

    for (const b of screen.getAllByRole('button', { name: /^F\d/ })) {
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
