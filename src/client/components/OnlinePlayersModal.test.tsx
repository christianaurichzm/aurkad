import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlinePlayersModal } from './OnlinePlayersModal';

const mocks = vi.hoisted(() => ({
  fetchOnlinePlayers: vi.fn(),
  modKick: vi.fn(),
  useGame: vi.fn(),
  usePlayerForceUpdate: vi.fn(),
}));

vi.mock('../io/network', () => ({
  fetchOnlinePlayers: mocks.fetchOnlinePlayers,
  modKick: mocks.modKick,
  modBan: vi.fn(),
  modBring: vi.fn(),
  modGoto: vi.fn(),
  modWarp: vi.fn(),
  modSetAccess: vi.fn(),
  modSetSprite: vi.fn(),
}));

vi.mock('../context/GameContext', () => ({
  useGame: mocks.useGame,
}));

vi.mock('../hooks/usePlayerForceUpdate', () => ({
  usePlayerForceUpdate: mocks.usePlayerForceUpdate,
}));

describe('OnlinePlayersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useGame.mockReturnValue({ player: { access: 0 } });
    mocks.usePlayerForceUpdate.mockReturnValue(null);
    mocks.fetchOnlinePlayers.mockResolvedValue({
      players: ['Alice', 'Bob'],
      count: 2,
    });
  });

  it('loads and renders online player names when opened', async () => {
    render(<OnlinePlayersModal />);

    act(() => {
      window.dispatchEvent(new Event('toggleOnlinePlayers'));
    });

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('2 online')).toBeInTheDocument();
    expect(mocks.fetchOnlinePlayers).toHaveBeenCalledTimes(1);
  });

  it('hides moderation actions from a non-mod viewer', async () => {
    render(<OnlinePlayersModal />);
    act(() => window.dispatchEvent(new Event('toggleOnlinePlayers')));

    const alice = await screen.findByText('Alice');
    act(() => fireEvent.click(alice.closest('li')!));

    expect(screen.queryByText('Kick')).not.toBeInTheDocument();
  });

  it('lets a mod select a player and kick them', async () => {
    mocks.useGame.mockReturnValue({ player: { access: 2 } });
    mocks.modKick.mockResolvedValue({});
    render(<OnlinePlayersModal />);
    act(() => window.dispatchEvent(new Event('toggleOnlinePlayers')));

    const alice = await screen.findByText('Alice');
    act(() => fireEvent.click(alice.closest('li')!));

    const kickBtn = await screen.findByText('Kick');
    await act(async () => {
      fireEvent.click(kickBtn);
    });

    expect(mocks.modKick).toHaveBeenCalledWith('Alice');
  });
});
