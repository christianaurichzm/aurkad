import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import '../../io/network/wsManager';
import { dispatchServerEvent } from '../../io/network/customEvents';
import { HudBar, MapName } from './HudBar';
import { useUIStore } from '../../stores/uiStore';

// The card names the player, which is session state rather than store state;
// the bars below it are what these cases are about.
vi.mock('../../context/GameContext', () => ({
  useGame: () => ({ player: { name: 'Alice', sprite: 3 } }),
}));

vi.mock('../../hooks/usePlayerForceUpdate', () => ({
  usePlayerForceUpdate: () => null,
}));

describe('HudBar Component', () => {
  it('marks the portrait with the sprite id, for a theme to pick a picture by', () => {
    const { container } = render(<HudBar />);
    expect(container.querySelector('#hud-portrait')).toHaveAttribute(
      'data-sprite',
      '3',
    );
  });

  it('shows mana only after magic publishes its state and follows consumption', () => {
    const { unmount } = render(<HudBar />);
    expect(
      screen.queryByRole('progressbar', { name: 'Mana' }),
    ).not.toBeInTheDocument();
    act(() => dispatchServerEvent('magic:update', { mana: 70, manaMax: 100 }));
    expect(screen.getByRole('progressbar', { name: 'Mana' })).toHaveAttribute(
      'aria-valuenow',
      '70',
    );
    act(() => dispatchServerEvent('magic:update', { mana: 25, manaMax: 100 }));
    expect(screen.getByText('25/100')).toBeInTheDocument();
    act(() => dispatchServerEvent('magic:update', { mana: NaN, manaMax: 0 }));
    expect(screen.getByRole('progressbar', { name: 'Mana' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    unmount();
    render(<HudBar />);
    expect(
      screen.queryByRole('progressbar', { name: 'Mana' }),
    ).not.toBeInTheDocument();
  });

  beforeEach(() => {
    useUIStore.setState({
      playerHealth: {
        current: 100,
        max: 100,
      },
    });
  });

  it('should render health bar with 100% health', () => {
    render(<HudBar />);

    const text = screen.getByText('100%');
    expect(text).toBeInTheDocument();
  });

  it('should render level with hp label', () => {
    useUIStore.setState({
      playerHealth: {
        current: 100,
        max: 100,
        level: 5,
      },
    });

    render(<HudBar />);

    expect(screen.getByText('Level 5')).toBeInTheDocument();
    expect(screen.getByText('HP')).toBeInTheDocument();
  });

  it('should render current and max hp next to the bar', () => {
    useUIStore.setState({
      playerHealth: {
        current: 75,
        max: 120,
        level: 4,
      },
    });

    render(<HudBar />);

    expect(screen.getByText('75/120')).toBeInTheDocument();
  });

  it('should render health bar with 75% health (green)', () => {
    useUIStore.setState({
      playerHealth: {
        current: 75,
        max: 100,
      },
    });

    render(<HudBar />);

    const text = screen.getByText('75%');
    expect(text).toBeInTheDocument();
  });

  it('should render health bar with 50% health (yellow)', () => {
    useUIStore.setState({
      playerHealth: {
        current: 50,
        max: 100,
      },
    });

    render(<HudBar />);

    const text = screen.getByText('50%');
    expect(text).toBeInTheDocument();
  });

  it('should render health bar with 20% health (red)', () => {
    useUIStore.setState({
      playerHealth: {
        current: 20,
        max: 100,
      },
    });

    render(<HudBar />);

    const text = screen.getByText('20%');
    expect(text).toBeInTheDocument();
  });

  it('should render health bar with 0% health', () => {
    useUIStore.setState({
      playerHealth: {
        current: 0,
        max: 100,
      },
    });

    render(<HudBar />);

    const text = screen.getByText('0%');
    expect(text).toBeInTheDocument();
  });

  it('should handle different max health values', () => {
    useUIStore.setState({
      playerHealth: {
        current: 75,
        max: 150,
      },
    });

    render(<HudBar />);

    const text = screen.getByText('50%');
    expect(text).toBeInTheDocument();
  });

  it('should render the xp bar with current/max experience', () => {
    useUIStore.setState({
      playerHealth: { current: 100, max: 100, level: 3 },
      playerXp: { current: 40, max: 160 },
    });

    render(<HudBar />);

    expect(screen.getByText('XP 40/160')).toBeInTheDocument();
    const xpBar = document.getElementById('xp-bar');
    expect(xpBar).toBeInTheDocument();
    expect(xpBar).toHaveStyle({ width: '25%' });
  });

  it('should render health bar element with correct id', () => {
    render(<HudBar />);

    const healthBar = document.getElementById('health-bar');
    expect(healthBar).toBeInTheDocument();
  });

  it('should render health bar text element with correct id', () => {
    render(<HudBar />);

    const healthBarText = document.getElementById('health-bar-text');
    expect(healthBarText).toBeInTheDocument();
  });

  it('should update when health changes', () => {
    const { rerender } = render(<HudBar />);
    expect(screen.getByText('100%')).toBeInTheDocument();

    useUIStore.setState({
      playerHealth: {
        current: 50,
        max: 100,
      },
    });

    rerender(<HudBar />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });
});

describe('MapName', () => {
  it('marks a map PvP by the morale the server fights by, not by its type', () => {
    const shown = (map: {
      type: 'normal' | 'pvp';
      pvp?: 'safe' | 'normal';
    }) => {
      useUIStore.setState({ currentMap: { id: '1', name: 'Vale', ...map } });
      const { container, unmount } = render(<MapName />);
      const pvp = container
        .querySelector('#map-name')!
        .classList.contains('map-name-pvp');
      unmount();
      return pvp;
    };

    expect(shown({ type: 'normal', pvp: 'normal' })).toBe(true);
    expect(shown({ type: 'pvp', pvp: 'safe' })).toBe(false);
    expect(shown({ type: 'pvp' })).toBe(true);
    expect(shown({ type: 'normal' })).toBe(false);
  });
});
