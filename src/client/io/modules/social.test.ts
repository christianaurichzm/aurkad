import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/social/client.jsx, compiled and loaded the way the
// browser gets it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('social');
});

const update = (payload: unknown) =>
  act(() => mod.handlers.get('social:update')!(payload));
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown][] };
    }
  ).mock.calls;
const openWindow = () => act(() => mod.actions.get('Social')!.click());
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const nameField = () =>
  screen.getByPlaceholderText<HTMLInputElement>('Player name');
const type = (value: string) =>
  fireEvent.change(nameField(), { target: { value } });
const text = () => screen.getByRole('dialog').textContent;
const entries = () => screen.getAllByRole('listitem');

const LISTS = {
  friends: [
    { name: 'Bo', online: true },
    { name: 'Cy', online: false },
  ],
  ignored: ['Troll'],
  maxFriends: 100,
  maxIgnored: 100,
};

describe('on load', () => {
  it('asks the server for the lists', () => {
    expect(sent()).toContainEqual(['social:request']);
  });

  it('opens from the Actions menu and closes on Escape', () => {
    openWindow();
    expect(
      screen.getByRole('dialog', { name: 'Friends (0/0 online)' }),
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('puts the two things a click on a player is for in the menu', () => {
    const registered = (
      mod.engine.registerPlayerAction as {
        mock: { calls: [string, (name: string) => void][] };
      }
    ).mock.calls;

    registered.find((c) => c[0] === 'Add friend')![1]('Bo');
    registered.find((c) => c[0] === 'Ignore')![1]('Troll');

    expect(sent()).toContainEqual(['social:friendAdd', { name: 'Bo' }]);
    expect(sent()).toContainEqual(['social:ignoreAdd', { name: 'Troll' }]);
  });

  it('draws an empty state rather than a blank window', () => {
    openWindow();

    expect(text()).toContain('No friends yet.');
  });
});

describe('the friends tab', () => {
  beforeEach(() => {
    openWindow();
    update(LISTS);
  });

  it('lists each friend with whether they are online', () => {
    const [bo, cy] = entries();

    expect(within(bo).getByText('Bo')).toBeTruthy();
    expect(within(bo).getByText('online')).toBeTruthy();
    expect(within(cy).getByText('Cy')).toBeTruthy();
    expect(within(cy).getByText('offline')).toBeTruthy();
  });

  it('counts the online ones in the title', () => {
    expect(
      screen.getByRole('dialog', { name: 'Friends (1/2 online)' }),
    ).toBeTruthy();
  });

  it('removes the friend whose row was clicked', () => {
    fireEvent.click(
      within(entries()[0]).getByRole('button', { name: 'Remove' }),
    );

    expect(sent()).toContainEqual(['social:friendRemove', { name: 'Bo' }]);
  });

  it('adds the typed name and clears the field', () => {
    type('  Dee  ');

    click('Add');

    expect(sent()).toContainEqual(['social:friendAdd', { name: 'Dee' }]);
    expect(nameField().value).toBe('');
  });

  it('adds on Enter too', () => {
    type('Dee');

    fireEvent.keyDown(nameField(), { key: 'Enter' });

    expect(sent()).toContainEqual(['social:friendAdd', { name: 'Dee' }]);
  });

  it('sends nothing for an empty field', () => {
    const before = sent().length;
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toHaveProperty('disabled', true);

    fireEvent.click(add);
    fireEvent.keyDown(nameField(), { key: 'Enter' });

    expect(sent()).toHaveLength(before);
  });

  it('keeps a half-typed name through an update from the server', () => {
    type('De');

    update({
      ...LISTS,
      friends: [...LISTS.friends, { name: 'Ed', online: true }],
    });

    expect(
      screen.getByRole('dialog', { name: 'Friends (2/3 online)' }),
    ).toBeTruthy();
    expect(nameField().value).toBe('De');
  });
});

describe('the ignored tab', () => {
  beforeEach(() => {
    openWindow();
    update(LISTS);
    click('Ignored');
  });

  it('switches to the other list, and says so in the title', () => {
    expect(screen.getByRole('dialog', { name: 'Ignored' })).toBeTruthy();
    expect(text()).toContain('Troll');
    expect(text()).not.toContain('Bo');
  });

  it('sends the add on the ignore channel, not the friend one', () => {
    type('Spammer');

    click('Add');

    expect(sent()).toContainEqual(['social:ignoreAdd', { name: 'Spammer' }]);
  });

  it('removes from the ignore list', () => {
    fireEvent.click(
      within(entries()[0]).getByRole('button', { name: 'Remove' }),
    );

    expect(sent()).toContainEqual(['social:ignoreRemove', { name: 'Troll' }]);
  });

  it('says so when nobody is ignored', () => {
    update({ ...LISTS, ignored: [] });

    expect(text()).toContain('Nobody ignored.');
  });

  it('keeps a half-typed name through a tab switch', () => {
    type('Sp');

    click('Friends');
    click('Ignored');

    expect(nameField().value).toBe('Sp');
  });

  it('is still the tab when the window is opened again', () => {
    fireEvent.keyDown(window, { key: 'Escape' });
    openWindow();

    expect(screen.getByRole('dialog', { name: 'Ignored' })).toBeTruthy();
  });
});

describe('a payload that is not there', () => {
  it('is ignored rather than drawn from', () => {
    openWindow();
    update(LISTS);
    expect(() => update(null)).not.toThrow();
    expect(text()).toContain('Bo'); // the last good state is kept
  });
});
