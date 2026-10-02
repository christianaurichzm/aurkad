import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Access } from '../../shared/types';
import { ActionPanel, CreatorTools } from './ActionPanel';
import { registerModuleAction } from '../io/modules/moduleActions';

const mocks = vi.hoisted(() => ({
  openContentEditor: vi.fn(),
  openMapEditor: vi.fn(),
  openModEditor: vi.fn(),
  openConsole: vi.fn(),
  useGame: vi.fn(),
  usePlayerForceUpdate: vi.fn(),
  fetchGameBrand: vi.fn(),
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
  openConsole: mocks.openConsole,
  fetchGameBrand: mocks.fetchGameBrand,
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
    mocks.fetchGameBrand.mockResolvedValue({ attributes: true });
  });

  it('shows only user actions for regular users', () => {
    render(
      <>
        <ActionPanel />
        <CreatorTools />
      </>,
    );

    expect(
      screen.getByRole('button', { name: /inventory/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /attributes/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /online players/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /gm/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /map editor/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /content/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Creator tools')).not.toBeInTheDocument();
  });

  it('has no Attributes tile in a game that hands out no points', async () => {
    mocks.fetchGameBrand.mockResolvedValue({ attributes: false });
    render(<ActionPanel />);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /attributes/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /inventory/i })).toBeVisible();
  });

  it('has no Inventory tile in a game with no bag', async () => {
    mocks.fetchGameBrand.mockResolvedValue({ inventory: false });
    render(<ActionPanel />);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /inventory/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /online players/i }),
    ).toBeVisible();
  });

  it('names a tile by its panel and its hotkey apart', () => {
    render(<ActionPanel />);

    expect(screen.getByRole('button', { name: 'Inventory' })).toHaveAttribute(
      'aria-keyshortcuts',
      'I',
    );
  });

  it('keeps moderation collapsed until requested, without admin editors', async () => {
    setAccess(Access.MOD);

    render(<CreatorTools />);

    expect(screen.getByRole('button', { name: /gm/i })).not.toBeVisible();
    await userEvent.click(screen.getByText('Creator tools'));
    expect(screen.getByRole('button', { name: /gm/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /map editor/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /content/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps creator tools collapsed even for admins', async () => {
    setAccess(Access.ADMIN);

    render(<CreatorTools />);

    expect(
      screen.getByRole('button', { name: /map editor/i }),
    ).not.toBeVisible();
    await userEvent.click(screen.getByText('Creator tools'));

    expect(
      screen.getByRole('button', { name: /map editor/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /content/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gm/i })).toBeInTheDocument();
  });

  it('dispatches a protected panel event only after authorization succeeds', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    setAccess(Access.ADMIN);
    mocks.openMapEditor.mockResolvedValue(true);
    window.addEventListener('toggleTilesetEditor', onToggle);

    render(<CreatorTools />);

    await user.click(screen.getByText('Creator tools'));
    await user.click(screen.getByRole('button', { name: /map editor/i }));

    await waitFor(() => expect(mocks.openMapEditor).toHaveBeenCalledTimes(1));
    expect(onToggle).toHaveBeenCalledTimes(1);

    window.removeEventListener('toggleTilesetEditor', onToggle);
  });

  it('dispatches the online players event', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    window.addEventListener('toggleOnlinePlayers', onToggle);

    render(<ActionPanel />);

    await user.click(screen.getByRole('button', { name: /online players/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);

    window.removeEventListener('toggleOnlinePlayers', onToggle);
  });

  it('draws a module tile with its icon, or its initial for a name it lacks', () => {
    registerModuleAction('Guild', vi.fn(), 'g', 'guild');
    registerModuleAction('Bestiary', vi.fn(), undefined, 'dragon');

    render(<ActionPanel />);

    const guild = screen.getByRole('button', { name: 'Guild' });
    expect(guild.querySelector('.icon-guild')).toBeInTheDocument();
    expect(guild).toHaveAttribute('aria-keyshortcuts', 'G');
    const bestiary = screen.getByRole('button', { name: 'Bestiary' });
    expect(bestiary.querySelector('.icon')).not.toBeInTheDocument();
    expect(bestiary.querySelector('.action-monogram')).toHaveTextContent('B');
  });

  it('places tiles by their order, and one without it after the rest', () => {
    registerModuleAction('Bazaar', vi.fn());
    registerModuleAction('Trade', vi.fn(), 't', 'trade', 70);
    registerModuleAction('Spells', vi.fn(), 's', 'spellbook', 30);

    render(<ActionPanel />);

    const labels = screen
      .getAllByRole('button')
      .map((button) => button.querySelector('.action-label')?.textContent);
    const at = (label: string) => labels.indexOf(label);
    expect(at('Inventory')).toBe(0);
    expect(at('Attributes')).toBeLessThan(at('Spells'));
    expect(at('Spells')).toBeLessThan(at('Trade'));
    expect(at('Trade')).toBeLessThan(at('Online players'));
    expect(at('Online players')).toBeLessThan(at('Bazaar'));
  });
});
