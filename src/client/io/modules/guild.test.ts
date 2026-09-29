import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/guild/client.jsx, compiled and loaded the way the
// browser gets it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('guild');
});

const emit = (channel: string, payload: unknown) =>
  act(() => mod.handlers.get(channel)!(payload));
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;
const openWindow = () => act(() => mod.actions.get('Guild')!.click());

const GUILD = {
  name: 'Wolves',
  privacy: 'public',
  self: 'Ana',
  members: [
    { name: 'Ana', role: 'owner' },
    { name: 'Bo', role: 'member' },
  ],
};

describe('guild window', () => {
  it('opens from the Actions menu and closes on Escape', () => {
    openWindow();
    expect(screen.getByRole('dialog', { name: 'Guild' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates a guild with the name and privacy chosen', () => {
    openWindow();
    const create = screen.getByRole('button', { name: 'Create Guild' });
    expect(create).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('Guild name'), {
      target: { value: '  Wolves ' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Privacy' }), {
      target: { value: 'private' },
    });
    fireEvent.click(create);
    expect(sent()).toContainEqual([
      'guild:create',
      { name: 'Wolves', privacy: 'private' },
    ]);
  });

  it('keeps a half-typed invite through an update from the server', () => {
    emit('guild:update', GUILD);
    openWindow();
    const invitee = screen.getByPlaceholderText('Invite player name');
    fireEvent.change(invitee, { target: { value: 'Ca' } });
    emit('guild:update', {
      ...GUILD,
      members: [...GUILD.members, { name: 'Di', role: 'member' }],
    });
    expect(screen.getByRole('dialog', { name: 'Wolves (3)' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Invite player name')).toHaveProperty(
      'value',
      'Ca',
    );
  });

  it('gives the owner rank and kick controls on others, not on itself', () => {
    emit('guild:update', GUILD);
    openWindow();
    const [ana, bo] = screen.getAllByRole('listitem');
    expect(within(ana).queryAllByRole('button')).toHaveLength(0);
    fireEvent.click(within(bo).getByRole('button', { name: 'Kick' }));
    expect(sent()).toContainEqual(['guild:kick', { target: 'Bo' }]);
  });
});

describe('invites', () => {
  it('opens a window of its own that accepting closes', () => {
    emit('guild:invite', { guildName: 'Wolves', from: 'Bo' });
    const invite = screen.getByRole('dialog', {
      name: 'Guild invite: Wolves',
    });
    expect(invite.textContent).toContain('Bo invited you to "Wolves"');
    fireEvent.click(within(invite).getByRole('button', { name: 'Accept' }));
    expect(sent()).toContainEqual(['guild:accept', { guildName: 'Wolves' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
