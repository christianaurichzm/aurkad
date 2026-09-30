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
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

const GUILD = {
  name: 'Wolves',
  privacy: 'public',
  self: 'Ana',
  maxMembers: 50,
  members: [
    { name: 'Bo', role: 'member', online: false },
    { name: 'Ana', role: 'owner', online: true, level: 7 },
  ],
};

describe('in no guild', () => {
  it('opens from the Actions menu and closes on Escape', () => {
    openWindow();
    expect(screen.getByRole('dialog', { name: 'Guild' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates a guild with the name and privacy chosen', () => {
    openWindow();
    const create = screen.getByRole('button', { name: 'Create guild' });
    expect(create).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('Guild name'), {
      target: { value: '  Wolves ' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Private/ }));
    fireEvent.click(create);
    expect(sent()).toContainEqual([
      'guild:create',
      { name: 'Wolves', privacy: 'private' },
    ]);
  });

  it('lists the public guilds it asked for, each a click to join', () => {
    openWindow();
    expect(sent()).toContainEqual(['guild:list']);
    expect(screen.getByText('No public guilds yet.')).toBeTruthy();

    emit('guild:list', {
      guilds: [{ name: 'Wolves', members: 3 }],
      maxMembers: 50,
    });
    expect(screen.getByText('3 of 50 members')).toBeTruthy();
    click('Join');
    expect(sent()).toContainEqual(['guild:join', { name: 'Wolves' }]);
  });

  it('says in the window why the server refused', () => {
    openWindow();
    emit('guild:result', { message: 'That guild name is taken.' });
    expect(screen.getByRole('status').textContent).toBe(
      'That guild name is taken.',
    );
  });
});

describe('in a guild', () => {
  beforeEach(() => {
    emit('guild:update', GUILD);
    openWindow();
  });

  it('counts the members beside the name and lists the owner first', () => {
    const dialog = screen.getByRole('dialog', { name: 'Wolves' });
    expect(dialog.textContent).toContain('2/50');
    expect(dialog.textContent).toContain('Public guild · 1 online');
    const [ana, bo] = screen.getAllByRole('listitem');
    expect(ana.textContent).toBe('AAna (you)Owner · Lv 7 · Online');
    expect(bo.textContent).toContain('Member · Offline');
  });

  it('keeps a half-typed invite through an update from the server', () => {
    const invitee = screen.getByPlaceholderText('Invite a player by name');
    fireEvent.change(invitee, { target: { value: 'Ca' } });
    emit('guild:update', {
      ...GUILD,
      members: [...GUILD.members, { name: 'Di', role: 'member' }],
    });
    expect(screen.getByRole('dialog').textContent).toContain('3/50');
    expect(
      screen.getByPlaceholderText('Invite a player by name'),
    ).toHaveProperty('value', 'Ca');
  });

  it('gives the owner rank and kick controls on others, not on itself', () => {
    const [ana, bo] = screen.getAllByRole('listitem');
    expect(within(ana).queryAllByRole('button')).toHaveLength(0);
    fireEvent.click(within(bo).getByRole('button', { name: 'Promote Bo' }));
    fireEvent.click(within(bo).getByRole('button', { name: 'Kick Bo' }));
    expect(sent()).toContainEqual(['guild:promote', { target: 'Bo' }]);
    expect(sent()).toContainEqual(['guild:kick', { target: 'Bo' }]);
  });

  it('lets an officer remove a member and nothing else', () => {
    emit('guild:update', {
      ...GUILD,
      self: 'Cy',
      members: [...GUILD.members, { name: 'Cy', role: 'moderator' }],
    });
    const names = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
      .filter(Boolean);
    expect(names).toEqual(['Close', 'Kick Bo']);
  });

  it('asks before leaving, then lists the guilds to join', () => {
    click('Leave guild');
    expect(sent()).not.toContainEqual(['guild:leave', undefined]);
    click('Leave');
    expect(sent()).toContainEqual(['guild:leave', undefined]);

    emit('guild:update', null);
    expect(screen.getByRole('dialog', { name: 'Guild' })).toBeTruthy();
    expect(sent()).toContainEqual(['guild:list']);
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
