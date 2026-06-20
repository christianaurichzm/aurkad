import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudBar } from './HudBar';
import { useUIStore } from '../../stores/uiStore';

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
