import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/achievements/client.jsx, compiled and loaded the way
// the browser gets it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  mod = loadClientModule('achievements');
});

afterEach(() => {
  vi.useRealTimers();
});

const openWindow = () => act(() => mod.actions.get('Achievements')!.click());
const update = (payload: unknown) =>
  act(() => mod.handlers.get('achievements:update')!(payload));
const earn = (payload: unknown) =>
  act(() => mod.handlers.get('achievements:earned')!(payload));

const STATE = {
  earned: ['first_blood'],
  all: [
    {
      id: 'slayer',
      name: 'Slayer',
      description: 'Defeat 50.',
      progress: 5,
      target: 50,
    },
    {
      id: 'first_blood',
      name: 'First Blood',
      description: 'Defeat one.',
      progress: 1,
      target: 1,
    },
  ],
};

describe('the window', () => {
  it('asks the server for the list on load', () => {
    expect(
      (
        mod.engine.sendServerEvent as unknown as {
          mock: { calls: [string][] };
        }
      ).mock.calls,
    ).toContainEqual(['achievements:request']);
  });

  it('opens from the Actions menu and closes on Escape', () => {
    openWindow();
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says nothing is defined rather than showing a blank window', () => {
    openWindow();

    expect(screen.getByRole('dialog').textContent).toContain(
      'Nothing defined yet.',
    );
  });

  it('counts the earned ones beside the title', () => {
    update(STATE);
    openWindow();

    expect(
      screen.getByRole('dialog', { name: 'Achievements' }).textContent,
    ).toContain('1/2');
  });

  it('puts the earned ones first: a trophy case before a to-do list', () => {
    update(STATE);
    openWindow();

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.hasAttribute('data-dim'))).toEqual([
      false,
      true,
    ]);
    expect(within(rows[0]).getByText('First Blood')).toBeTruthy();
    expect(within(rows[0]).getByText('Unlocked')).toBeTruthy();
  });

  it('says when one was earned, once the server kept the day', () => {
    const at = new Date(2026, 8, 30).getTime();
    update({ ...STATE, at: { first_blood: at } });
    openWindow();

    expect(screen.getAllByRole('listitem')[0].textContent).toContain(
      `Unlocked ${new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' })}`,
    );
  });

  it('shows progress on a locked one and nothing on an earned one', () => {
    update(STATE);
    openWindow();

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('5/50');
    expect(dialog.textContent).not.toContain('1/1');
    expect(
      screen.getByRole('meter', { name: 'Slayer progress' }),
    ).toHaveProperty('ariaValueNow', '5');
  });
});

describe('the toast', () => {
  it('appears on the event and takes itself away', () => {
    earn({ id: 'slayer', name: 'Slayer' });

    expect(mod.container.textContent).toContain('Slayer');
    expect(mod.container.textContent).toContain('Achievement unlocked');

    vi.advanceTimersByTime(3200);
    expect(mod.container.children).toHaveLength(0);
  });

  it('does not appear for a payload with no name', () => {
    earn({});
    earn(null);

    expect(mod.container.children).toHaveLength(0);
  });
});
