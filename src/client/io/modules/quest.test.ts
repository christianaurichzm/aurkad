import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/quest/client.jsx, compiled and loaded the way the
// browser gets it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('quest');
});

const update = (list: unknown) =>
  act(() => mod.handlers.get('quest:update')!(list));
const openWindow = () => act(() => mod.actions.get('Quests')!.click());
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;

const quest = (id: string, name: string, status: string) => ({
  id,
  name,
  status,
  progress: status === 'completed' ? 1 : 0,
  target: 1,
});

describe('the toasts', () => {
  it('announces a quest taken and a quest finished, over the world', () => {
    const orcs = quest('orcs', 'Orcs at the gate', 'active');

    // What the player already had when the game opened is not news.
    update([orcs]);
    expect(mod.container.textContent).toBe('');

    update([orcs, quest('crypt', 'Clear the Crypt', 'active')]);
    expect(mod.container.textContent).toContain('New quest: Clear the Crypt');

    update([
      orcs,
      {
        ...quest('crypt', 'Clear the Crypt', 'completed'),
        reward: {
          experience: 50,
          items: [{ name: 'Gold Coin', quantity: 25 }],
        },
      },
    ]);
    expect(mod.container.textContent).toContain(
      'Quest complete: Clear the Crypt',
    );
    expect(mod.container.textContent).toContain('+50 XP · +25 Gold Coin');
    expect(mod.engine.chat).toHaveBeenCalledWith(
      'Quest completed: Clear the Crypt',
    );
  });
});

describe('the tracker window', () => {
  it('opens from the Actions menu, asks for the list and closes on Escape', () => {
    const before = sent().length;
    openWindow();
    expect(screen.getByRole('dialog', { name: 'Quests' })).toBeTruthy();
    expect(sent().slice(before)).toEqual([['quest:request']]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says there are no quests rather than showing a blank window', () => {
    openWindow();
    expect(screen.getByRole('dialog').textContent).toContain('No quests yet.');
  });

  it('counts the active quests and tucks the finished ones away', () => {
    update([
      {
        ...quest('orcs', 'Orcs at the gate', 'active'),
        progress: 2,
        target: 5,
      },
      quest('crypt', 'Clear the Crypt', 'completed'),
    ]);
    openWindow();

    const dialog = screen.getByRole('dialog', { name: 'Quests (1 active)' });
    expect(within(dialog).getByText('2/5')).toBeTruthy();
    const finished = dialog.querySelector('details')!;
    expect(within(finished).getByText('Completed (1)')).toBeTruthy();
    expect(within(finished).getByText('Clear the Crypt')).toBeTruthy();
    expect(within(finished).getByText('✓ Done')).toBeTruthy();
  });
});
