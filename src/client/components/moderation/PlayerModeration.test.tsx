import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Access } from '../../../shared/types';
import { PlayerModeration } from './PlayerModeration';

const mocks = vi.hoisted(() => ({
  fetchOnlinePlayers: vi.fn(),
  modSetAccess: vi.fn(),
  modSetMyAccess: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  fetchOnlinePlayers: mocks.fetchOnlinePlayers,
  modSetAccess: mocks.modSetAccess,
  modSetMyAccess: mocks.modSetMyAccess,
}));

describe('PlayerModeration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOnlinePlayers.mockResolvedValue({
      players: ['Alice', 'Rowan'],
      count: 2,
    });
    mocks.modSetAccess.mockResolvedValue({});
    mocks.modSetMyAccess.mockResolvedValue({});
  });

  it('shows the actions only once a target is picked', async () => {
    render(
      <PlayerModeration
        access={Access.ADMIN}
        self="Rowan"
        onResult={vi.fn()}
      />,
    );

    expect(screen.queryByText('Set access')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('Alice'));
    expect(screen.getByText('Set access')).toBeInTheDocument();
  });

  it('applies no access level until one is chosen', async () => {
    render(
      <PlayerModeration
        access={Access.ADMIN}
        self="Rowan"
        onResult={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText('Alice'));

    expect(screen.getByLabelText('Access level')).toHaveValue('');
    expect(screen.getByText('Set access')).toBeDisabled();
  });

  it('sets the operator’s own access without ending their session', async () => {
    render(
      <PlayerModeration
        access={Access.ADMIN}
        self="Rowan"
        onResult={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText('Rowan'));
    // Starts on the level the operator already holds, which is no change.
    expect(screen.getByLabelText('Access level')).toHaveValue(
      String(Access.ADMIN),
    );
    expect(screen.getByText('Set access')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Access level'), {
      target: { value: String(Access.MOD) },
    });
    fireEvent.click(screen.getByText('Set access'));

    expect(mocks.modSetMyAccess).toHaveBeenCalledWith(Access.MOD);
    expect(mocks.modSetAccess).not.toHaveBeenCalled();
    // Kicking or banning yourself is never what the operator meant.
    expect(screen.queryByText('Kick')).not.toBeInTheDocument();
  });
});
