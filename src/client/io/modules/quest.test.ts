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

  const LOG = [
    quest('crypt', 'Clear the Crypt', 'completed'),
    {
      ...quest('orcs', 'Orcs at the gate', 'active'),
      description: 'Drive them off.',
      from: 'Thomas',
      progress: 2,
      target: 5,
      reward: {
        experience: 50,
        items: [{ name: 'Gold Coin', sprite: 3, quantity: 25 }],
      },
    },
  ];

  it('counts the active quests and opens on the first of them', () => {
    update(LOG);
    openWindow();

    const dialog = screen.getByRole('dialog', { name: 'Quests' });
    expect(dialog.textContent).toContain('1 active');
    const detail = within(dialog).getByRole('article', {
      name: 'Orcs at the gate',
    });
    expect(detail.textContent).toContain('From Thomas');
    expect(detail.textContent).toContain('Drive them off.');
    expect(detail.textContent).toContain('2/5');
    expect(
      within(detail).getByRole('meter').getAttribute('aria-valuenow'),
    ).toBe('2');
    expect(
      within(detail).getByRole('img', { name: 'Gold Coin x25' }),
    ).toBeTruthy();
    expect(detail.textContent).toContain('+50 XP');
  });

  it('shows the quest that is picked, and keeps it picked through an update', () => {
    update(LOG);
    openWindow();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the Crypt' }));

    const detail = () => screen.getByRole('article').textContent;
    expect(detail()).toContain('Completed - rewards claimed.');
    update(LOG);
    expect(detail()).toContain('Clear the Crypt');
  });
});
