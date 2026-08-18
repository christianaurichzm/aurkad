import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudBar } from './HudBar';
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
