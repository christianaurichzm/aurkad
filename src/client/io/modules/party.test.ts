import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/party/client.jsx, compiled and loaded the way the
// browser gets it.

const rowan = { name: 'Rowan', health: 60, maxHealth: 120, level: 2 };
const kai = { name: 'Kai', health: 200, maxHealth: 200, level: 1 };

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('party', {
    getPlayer: () => rowan,
    getGameState: () => ({ players: { 'kai-id': kai } }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const emit = (channel: string, payload: unknown) =>
  act(() => mod.handlers.get(channel)!(payload));
const update = (payload: unknown) => emit('party:update', payload);
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;
const openWindow = () => act(() => mod.actions.get('Party')!.click());
const bars = () => screen.getAllByRole('meter');

const rows = () => screen.getAllByRole('listitem').map((li) => li.textContent);

describe('the party window', () => {
  it("shows each member's health and level, the leader first and marked", () => {
    update({ leader: 'Rowan', members: ['Kai', 'Rowan'], maxMembers: 5 });

    const dialog = screen.getByRole('dialog', { name: 'Party' });
    expect(dialog.textContent).toContain('2/5');
    expect(rows()).toEqual([
      'RRowanLeaderLv 2 · 60/120 HP',
      'KKaiLv 1 · 200/200 HP',
    ]);
    expect(bars().map((b) => b.getAttribute('aria-valuenow'))).toEqual([
      '60',
      '200',
    ]);
  });

  // The party only sends names; health comes from the world in view.
  it('leaves a member out of view without a health it does not know', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Ayla'], maxMembers: 5 });

    expect(rows()[1]).toBe('AAylaOut of sight');
    expect(bars()).toHaveLength(1);
  });

  it('opens itself when someone joins', () => {
    update({ leader: 'Rowan', members: ['Rowan'], maxMembers: 5 });
    expect(screen.queryByRole('dialog')).toBeNull();

    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });

    expect(screen.getByRole('dialog', { name: 'Party' })).toBeTruthy();
  });

  it('opens from the Actions menu and closes on Escape', () => {
    openWindow();
    expect(screen.getByRole('dialog', { name: 'Party' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps following a member health between updates', () => {
    vi.useFakeTimers();
    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });
    expect(rows()[0]).toContain('60/120 HP');

    rowan.health = 90;
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(rows()[0]).toContain('90/120 HP');
    rowan.health = 60;
  });

  it('leaves the party from the footer', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });
    fireEvent.click(screen.getByRole('button', { name: 'Leave party' }));
    expect(sent()).toContainEqual(['party:leave', undefined]);
  });

  it('says in the window why the server refused', () => {
    openWindow();
    emit('party:result', { message: 'Player not found.' });
    expect(screen.getByRole('status').textContent).toBe('Player not found.');
  });
});

describe('inviting', () => {
  it('creates a party or invites a player from the solo form', () => {
    openWindow();
    fireEvent.click(screen.getByRole('button', { name: 'Create party' }));
    expect(sent()).toContainEqual(['party:create', undefined]);

    fireEvent.change(screen.getByPlaceholderText('Invite a player'), {
      target: { value: ' Kai ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(sent()).toContainEqual(['party:invite', { name: 'Kai' }]);
  });

  it('keeps a half-typed name through an update from the server', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });
    fireEvent.change(screen.getByPlaceholderText('Invite a player'), {
      target: { value: 'Ay' },
    });

    update({
      leader: 'Rowan',
      members: ['Rowan', 'Kai', 'Bo'],
      maxMembers: 5,
    });

    expect(screen.getByRole('dialog').textContent).toContain('3/5');
    expect(screen.getByPlaceholderText('Invite a player')).toHaveProperty(
      'value',
      'Ay',
    );
  });

  it('clears the name once the invite is sent', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });
    const name = screen.getByPlaceholderText('Invite a player');
    fireEvent.change(name, { target: { value: 'Ayla' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(sent()).toContainEqual(['party:invite', { name: 'Ayla' }]);
    expect(name).toHaveProperty('value', '');
  });

  it('leaves inviting to the leader, and to a party with room', () => {
    update({ leader: 'Kai', members: ['Kai', 'Rowan'], maxMembers: 5 });
    expect(screen.queryByPlaceholderText('Invite a player')).toBeNull();
    expect(screen.getByText('Only the leader can invite.')).toBeTruthy();

    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 2 });
    expect(screen.getByText('Party is full.')).toBeTruthy();
  });
});

describe('invites', () => {
  it('opens a window of its own that accepting closes', () => {
    emit('party:invite', { from: 'Kai' });
    const invite = screen.getByRole('dialog', {
      name: 'Party invite from Kai',
    });
    fireEvent.click(within(invite).getByRole('button', { name: 'Accept' }));
    expect(sent()).toContainEqual(['party:accept', { leader: 'Kai' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Decline without answering', () => {
    emit('party:invite', { from: 'Kai' });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent().some(([channel]) => channel === 'party:accept')).toBe(false);
  });

  it('withdraws itself after 30 seconds', () => {
    vi.useFakeTimers();
    emit('party:invite', { from: 'Kai' });
    expect(screen.getByRole('dialog')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
