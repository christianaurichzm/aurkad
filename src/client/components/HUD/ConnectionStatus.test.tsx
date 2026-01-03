import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from './ConnectionStatus';
import { useUIStore } from '../../stores/uiStore';

describe('ConnectionStatus Component', () => {
  beforeEach(() => {
    useUIStore.setState({
      connectionStatus: {
        message: '',
        isError: false,
        visible: false,
      },
    });
  });

  it('should not render when hidden', () => {
    render(<ConnectionStatus />);

    const element = screen.queryByText(/./);
    expect(element).not.toBeInTheDocument();
  });

  it('should render success message when visible', () => {
    useUIStore.setState({
      connectionStatus: {
        message: 'Connected successfully',
        isError: false,
        visible: true,
      },
    });

    render(<ConnectionStatus />);

    const message = screen.getByText('Connected successfully');
    expect(message).toBeInTheDocument();
  });

  it('should render error message when visible', () => {
    useUIStore.setState({
      connectionStatus: {
        message: 'Connection failed',
        isError: true,
        visible: true,
      },
    });

    render(<ConnectionStatus />);

    const message = screen.getByText('Connection failed');
    expect(message).toBeInTheDocument();
  });

  it('should have correct id attribute', () => {
    useUIStore.setState({
      connectionStatus: {
        message: 'Test',
        isError: false,
        visible: true,
      },
    });

    render(<ConnectionStatus />);

    const element = document.getElementById('connection-status');
    expect(element).toBeInTheDocument();
  });

  it('should update when visibility changes', () => {
    const { rerender } = render(<ConnectionStatus />);

    expect(screen.queryByText('Test message')).not.toBeInTheDocument();

    useUIStore.setState({
      connectionStatus: {
        message: 'Test message',
        isError: false,
        visible: true,
      },
    });

    rerender(<ConnectionStatus />);
    expect(screen.getByText('Test message')).toBeInTheDocument();

    useUIStore.setState({
      connectionStatus: {
        message: 'Test message',
        isError: false,
        visible: false,
      },
    });

    rerender(<ConnectionStatus />);
    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });

  it('should update message content', () => {
    useUIStore.setState({
      connectionStatus: {
        message: 'First message',
        isError: false,
        visible: true,
      },
    });

    const { rerender } = render(<ConnectionStatus />);
    expect(screen.getByText('First message')).toBeInTheDocument();

    useUIStore.setState({
      connectionStatus: {
        message: 'Second message',
        isError: false,
        visible: true,
      },
    });

    rerender(<ConnectionStatus />);
    expect(screen.getByText('Second message')).toBeInTheDocument();
    expect(screen.queryByText('First message')).not.toBeInTheDocument();
  });
});
