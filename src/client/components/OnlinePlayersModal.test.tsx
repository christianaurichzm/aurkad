import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlinePlayersModal } from './OnlinePlayersModal';

const mocks = vi.hoisted(() => ({
  fetchOnlinePlayers: vi.fn(),
}));

vi.mock('../io/network', () => ({
  fetchOnlinePlayers: mocks.fetchOnlinePlayers,
}));

describe('OnlinePlayersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
