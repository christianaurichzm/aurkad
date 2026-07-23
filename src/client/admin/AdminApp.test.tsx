import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp';

const mocks = vi.hoisted(() => ({
  adminSession: vi.fn(),
  adminLogin: vi.fn(),
  adminLogout: vi.fn(),
  fetchOnlinePlayers: vi.fn(),
  fetchCommands: vi.fn(),
}));

vi.mock('../io/network', () => ({
  adminSession: mocks.adminSession,
  adminLogin: mocks.adminLogin,
  adminLogout: mocks.adminLogout,
  fetchOnlinePlayers: mocks.fetchOnlinePlayers,
  fetchCommands: mocks.fetchCommands,
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
});
