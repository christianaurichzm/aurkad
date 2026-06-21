import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Access } from '../../shared/types';
import { ActionPanel } from './ActionPanel';

const mocks = vi.hoisted(() => ({
  openContentEditor: vi.fn(),
  openMapEditor: vi.fn(),
  openModEditor: vi.fn(),
  useGame: vi.fn(),
  usePlayerForceUpdate: vi.fn(),
}));

vi.mock('../context/GameContext', () => ({
  useGame: mocks.useGame,
}));

vi.mock('../hooks/usePlayerForceUpdate', () => ({
  usePlayerForceUpdate: mocks.usePlayerForceUpdate,
}));

vi.mock('../io/network', () => ({
  openContentEditor: mocks.openContentEditor,
  openMapEditor: mocks.openMapEditor,
  openModEditor: mocks.openModEditor,
}));

const setAccess = (access: Access) => {
  const player = { access };
  mocks.useGame.mockReturnValue({ player });
  mocks.usePlayerForceUpdate.mockReturnValue(null);
};

describe('ActionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccess(Access.USER);
  });

  it('shows only user actions for regular users', () => {
    render(<ActionPanel />);

    expect(
      screen.getByRole('button', { name: /inventory/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /attributes/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /moderation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /map editor/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /content/i }),
    ).not.toBeInTheDocument();
  });

  it('shows moderation for moderators without admin editors', () => {
    setAccess(Access.MOD);

    render(<ActionPanel />);

    expect(
      screen.getByRole('button', { name: /moderation/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /map editor/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /content/i }),
    ).not.toBeInTheDocument();
  });

  it('shows editor actions for admins', () => {
    setAccess(Access.ADMIN);

    render(<ActionPanel />);

    expect(
      screen.getByRole('button', { name: /map editor/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /content/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /moderation/i }),
    ).toBeInTheDocument();
  });

  it('dispatches a protected panel event only after authorization succeeds', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    setAccess(Access.ADMIN);
    mocks.openMapEditor.mockResolvedValue(true);
    window.addEventListener('toggleTilesetEditor', onToggle);

    render(<ActionPanel />);

    await user.click(screen.getByRole('button', { name: /map editor/i }));

    await waitFor(() => expect(mocks.openMapEditor).toHaveBeenCalledTimes(1));
    expect(onToggle).toHaveBeenCalledTimes(1);

    window.removeEventListener('toggleTilesetEditor', onToggle);
  });
});
