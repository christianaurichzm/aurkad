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

describe('the party window', () => {
  it("shows each member's health and level, the leader first and marked", () => {
    update({ leader: 'Rowan', members: ['Kai', 'Rowan'], maxMembers: 5 });

    const dialog = screen.getByRole('dialog', { name: 'Party (2/5)' });
    expect(bars().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Rowan',
      'Kai',
    ]);
    expect(bars().map((b) => b.textContent)).toEqual(['60 / 120', '200 / 200']);
    expect(dialog.textContent).toContain('Level 2');
    expect(dialog.textContent).toContain('Leader');
  });

  // The party only sends names; health comes from the world in view.
  it('leaves a member out of view without a health it does not know', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Ayla'], maxMembers: 5 });

    expect(bars()[1]?.textContent).toBe('Out of sight');
  });

  it('opens itself when someone joins', () => {
    update({ leader: 'Rowan', members: ['Rowan'], maxMembers: 5 });
    expect(screen.queryByRole('dialog')).toBeNull();

    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });

    expect(screen.getByRole('dialog', { name: 'Party (2/5)' })).toBeTruthy();
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
    expect(bars()[0]?.textContent).toBe('60 / 120');

    rowan.health = 90;
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(bars()[0]?.textContent).toBe('90 / 120');
    rowan.health = 60;
  });

  it('leaves the party from the Leave button', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(sent()).toContainEqual(['party:leave']);
  });
});

describe('inviting', () => {
  it('creates a party or invites a player from the solo form', () => {
    openWindow();
    fireEvent.click(screen.getByRole('button', { name: 'Create Party' }));
    expect(sent()).toContainEqual(['party:create']);

    fireEvent.change(screen.getByPlaceholderText('Player name to invite'), {
      target: { value: ' Kai ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(sent()).toContainEqual(['party:invite', { name: 'Kai' }]);
  });

  it('keeps a half-typed name through an update from the server', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });
    fireEvent.change(screen.getByPlaceholderText('Invite player'), {
      target: { value: 'Ay' },
    });

    update({
      leader: 'Rowan',
      members: ['Rowan', 'Kai', 'Bo'],
      maxMembers: 5,
    });

    expect(screen.getByRole('dialog', { name: 'Party (3/5)' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Invite player')).toHaveProperty(
      'value',
      'Ay',
    );
  });

  it('clears the name once the invite is sent', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });
    const name = screen.getByPlaceholderText('Invite player');
    fireEvent.change(name, { target: { value: 'Ayla' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(sent()).toContainEqual(['party:invite', { name: 'Ayla' }]);
    expect(name).toHaveProperty('value', '');
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
