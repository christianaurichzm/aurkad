import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp';
import { Access } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  adminSession: vi.fn(),
  adminLogin: vi.fn(),
  adminLogout: vi.fn(),
  fetchOnlinePlayers: vi.fn(),
  fetchCommands: vi.fn(),
}));

vi.mock('../io/network', () => ({
  adminSession: mocks.adminSession,
  fetchGameBrand: () => Promise.resolve(null),
  adminLogin: mocks.adminLogin,
  adminLogout: mocks.adminLogout,
  fetchOnlinePlayers: mocks.fetchOnlinePlayers,
  fetchCommands: mocks.fetchCommands,
  fetchAuditLog: vi.fn().mockResolvedValue([]),
  fetchTheme: vi.fn().mockResolvedValue(null),
  fetchTwoFactor: vi.fn().mockResolvedValue({
    enabled: false,
    recoveryLeft: 0,
  }),
  beginTwoFactor: vi.fn(),
  confirmTwoFactor: vi.fn(),
  removeTwoFactor: vi.fn(),
  friendlyHttpError: (e: { message?: string }) => e?.message ?? 'failed',
  httpError: (e: unknown) => (typeof e === 'object' && e !== null ? e : {}),
  runConsoleCommand: vi.fn(),
  modKick: vi.fn(),
  modBan: vi.fn(),
  modWarp: vi.fn(),
  modSetAccess: vi.fn(),
  modSetSprite: vi.fn(),
}));

// Monaco doesn't run in jsdom; the panel's own tests cover its behavior.
vi.mock('../components/scripting/ScriptEditor', () => ({
  ScriptEditor: () => <div>script-editor-stub</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchOnlinePlayers.mockResolvedValue({ players: [], count: 0 });
  mocks.fetchCommands.mockResolvedValue([]);
});

describe('AdminApp', () => {
  it('shows the login form when there is no operator session', async () => {
    mocks.adminSession.mockResolvedValue(null);
    render(<AdminApp />);
    expect(await screen.findByText('Sign in')).toBeInTheDocument();
  });

  it('shows the dashboard when an operator session exists', async () => {
    mocks.adminSession.mockResolvedValue({ username: 'Boss', access: 2 });
    render(<AdminApp />);
    expect(await screen.findByText('Online players')).toBeInTheDocument();
    expect(screen.getByText('Console')).toBeInTheDocument();
  });

  it('hides the Scripts panel when the flag is off', async () => {
    mocks.adminSession.mockResolvedValue({
      username: 'Boss',
      access: 2,
      scriptEditorEnabled: false,
    });
    render(<AdminApp />);
    await screen.findByText('Online players');
    expect(screen.queryByText('Scripts')).not.toBeInTheDocument();
  });

  it('shows the Scripts panel when the flag is on', async () => {
    mocks.adminSession.mockResolvedValue({
      username: 'Boss',
      access: 2,
      scriptEditorEnabled: true,
    });
    render(<AdminApp />);
    expect(await screen.findByText('Scripts')).toBeInTheDocument();
  });

  // The panel does not put the operator in the world, so moderating while
  // playing means two tabs; the link opens one instead of navigating away.
  it('offers a way into the game without losing the panel', async () => {
    mocks.adminSession.mockResolvedValue({
      username: 'Boss',
      access: Access.ADMIN,
      scriptEditorEnabled: false,
    });
    render(<AdminApp />);

    const link = await screen.findByRole('link', { name: 'Open game' });
    expect(link).toHaveAttribute('href', '/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the audit trail to an admin', async () => {
    mocks.adminSession.mockResolvedValue({
      username: 'Boss',
      access: Access.ADMIN,
      scriptEditorEnabled: false,
    });
    render(<AdminApp />);
    expect(await screen.findByText('Audit trail')).toBeInTheDocument();
  });

  // A moderator can be the subject of the trail, so they do not get to read it.
  it('hides the audit trail from a moderator', async () => {
    mocks.adminSession.mockResolvedValue({
      username: 'Gm',
      access: Access.MOD,
      scriptEditorEnabled: false,
    });
    render(<AdminApp />);
    await screen.findByText('Online players');
    expect(screen.queryByText('Audit trail')).not.toBeInTheDocument();
  });

  // styles.css pins the body to 100vh with overflow hidden for the game
  // canvas, so the dashboard scrolls inside itself, or the panels below the
  // fold cannot be reached.
  it('scrolls inside itself, since the document cannot', async () => {
    mocks.adminSession.mockResolvedValue({
      username: 'Boss',
      access: Access.ADMIN,
      scriptEditorEnabled: true,
    });
    const { container } = render(<AdminApp />);
    await screen.findByText('Online players');

    const page = container.firstChild as HTMLElement;
    expect(page.style.overflowY).toBe('auto');
    expect(page.style.height).toBe('100vh');
  });
});
