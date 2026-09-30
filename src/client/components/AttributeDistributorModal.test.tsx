import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttributeDistributorModal } from './AttributeDistributorModal';

const state = vi.hoisted(() => ({
  player: {
    id: 'p1',
    unspentPoints: 3,
    strength: 12,
    defense: 8,
    vitality: 10,
    agility: 9,
  },
  assign: vi.fn(),
}));

vi.mock('../hooks/usePlayerForceUpdate', () => ({
  usePlayerForceUpdate: () => state.player,
}));
vi.mock('./common/AuthLayout', () => ({ useGameBrand: () => null }));
vi.mock('../io/network', () => ({
  assignPointsPlayer: state.assign,
  httpError: (e: unknown) => e,
}));

const open = () => {
  render(<AttributeDistributorModal />);
  act(() => {
    window.dispatchEvent(new Event('toggleAttributeDistributor'));
  });
};

describe('AttributeDistributorModal', () => {
  beforeEach(() => {
    state.player.unspentPoints = 3;
    state.assign.mockReset().mockResolvedValue(undefined);
  });

  it('queues points a press at a time and sends them together', async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByText('3 unspent points')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Increase Strength' }));
    await user.click(screen.getByRole('button', { name: 'Increase Strength' }));
    await user.click(screen.getByRole('button', { name: 'Increase Vitality' }));

    expect(screen.getByLabelText('Strength 12 to 14')).toBeInTheDocument();
    expect(screen.getByText('0 unspent points')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Increase Agility' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Decrease Vitality' }));
    expect(screen.getByText('1 unspent point')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm 2 points' }));
    expect(state.assign).toHaveBeenCalledWith('p1', {
      strength: 2,
      defense: 0,
      vitality: 0,
      agility: 0,
    });
    expect(screen.getByLabelText('Strength 12')).toBeInTheDocument();
  });

  it('puts everything back with Reset', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Increase Defense' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByText('3 unspent points')).toBeInTheDocument();
    expect(state.assign).not.toHaveBeenCalled();
  });

  it('keeps what was queued and says why when the server refuses', async () => {
    state.assign.mockRejectedValue(new Error('Not enough points'));
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Increase Agility' }));
    await user.click(screen.getByRole('button', { name: 'Confirm 1 point' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Not enough points');
    expect(screen.getByLabelText('Agility 9 to 10')).toBeInTheDocument();
  });

  it('is a sheet to read, with how to earn points, when there are none', () => {
    state.player.unspentPoints = 0;
    open();

    expect(screen.getByText('No points to spend.')).toBeInTheDocument();
    expect(screen.getByText('Level up to earn points.')).toBeInTheDocument();
    expect(screen.getByLabelText('Vitality 10')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Increase|Confirm|Reset/ }),
    ).not.toBeInTheDocument();
  });
});
