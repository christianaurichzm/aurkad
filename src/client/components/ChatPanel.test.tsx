import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from './ChatPanel';
import { useUIStore } from '../stores/uiStore';

describe('ChatPanel Component', () => {
  beforeEach(() => {
    useUIStore.setState({
      chat: {
        messages: [],
        inputValue: '',
        scope: 'map',
      },
    });
  });

  it('should render empty chat box initially', () => {
    render(<ChatPanel />);

    const chatBox = document.getElementById('chatBox');
    expect(chatBox).toBeInTheDocument();
    expect(chatBox?.children.length).toBe(0);
  });

  it('should render input and scope selector', () => {
    render(<ChatPanel />);

    const input = screen.getByPlaceholderText('Mensagem...');
    const select = document.getElementById('chatScope') as HTMLSelectElement;

    expect(input).toBeInTheDocument();
    expect(select).toBeInTheDocument();
  });

  it('should display chat messages', () => {
    useUIStore.setState({
      chat: {
        messages: [
          {
            type: 'chat',
            scope: 'map',
            message: 'Hello world',
            username: 'Player1',
          },
          {
            type: 'chat',
            scope: 'global',
            message: 'Test message',
            username: 'Player2',
          },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    render(<ChatPanel />);

    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    expect(screen.getByText(/Test message/)).toBeInTheDocument();
  });

  it('should update input value when typing', async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    const input = screen.getByPlaceholderText('Mensagem...');

    await user.type(input, 'Hello');

    expect(useUIStore.getState().chat.inputValue).toBe('Hello');
  });

  it('should update scope when changed', async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    const select = document.getElementById('chatScope') as HTMLSelectElement;

    await user.selectOptions(select, 'global');

    expect(useUIStore.getState().chat.scope).toBe('global');
  });

  it('should render map scope messages with correct class', () => {
    useUIStore.setState({
      chat: {
        messages: [
          {
            type: 'chat',
            scope: 'map',
            message: 'Map message',
            username: 'Player1',
          },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    render(<ChatPanel />);

    const messageEl = screen.getByText(/Map message/);
    expect(messageEl).toHaveClass('chat-map');
  });

  it('should render global scope messages with correct class', () => {
    useUIStore.setState({
      chat: {
        messages: [
          {
            type: 'chat',
            scope: 'global',
            message: 'Global message',
            username: 'Player1',
          },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    render(<ChatPanel />);

    const messageEl = screen.getByText(/Global message/);
    expect(messageEl).toHaveClass('chat-global');
  });

  it('should render player messages with correct class', () => {
    useUIStore.setState({
      chat: {
        messages: [
          { type: 'chat', scope: 'player', message: 'Player message' },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    render(<ChatPanel />);

    const messageEl = screen.getByText('Player message');
    expect(messageEl).toHaveClass('chat-player');
  });

  it('should render death messages with correct class', () => {
    useUIStore.setState({
      chat: {
        messages: [
          {
            type: 'chat',
            scope: 'map',
            message: 'Player1 died',
            subtype: 'death',
          },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    render(<ChatPanel />);

    const messageEl = screen.getByText('Player1 died');
    expect(messageEl).toHaveClass('chat-death');
  });

  it('should format messages with username', () => {
    useUIStore.setState({
      chat: {
        messages: [
          {
            type: 'chat',
            scope: 'map',
            message: 'Hello',
            username: 'TestUser',
          },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    render(<ChatPanel />);

    expect(screen.getByText('[map] TestUser: Hello')).toBeInTheDocument();
  });

  it('should format messages without username', () => {
    useUIStore.setState({
      chat: {
        messages: [
          { type: 'chat', scope: 'player', message: 'System message' },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    render(<ChatPanel />);

    expect(screen.getByText('System message')).toBeInTheDocument();
  });

  it('should update when new messages arrive', () => {
    const { rerender } = render(<ChatPanel />);

    expect(screen.queryByText(/First message/)).not.toBeInTheDocument();

    useUIStore.setState({
      chat: {
        messages: [
          {
            type: 'chat',
            scope: 'map',
            message: 'First message',
            username: 'User1',
          },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    rerender(<ChatPanel />);
    expect(screen.getByText(/First message/)).toBeInTheDocument();

    useUIStore.setState({
      chat: {
        messages: [
          {
            type: 'chat',
            scope: 'map',
            message: 'First message',
            username: 'User1',
          },
          {
            type: 'chat',
            scope: 'map',
            message: 'Second message',
            username: 'User2',
          },
        ],
        inputValue: '',
        scope: 'map',
      },
    });

    rerender(<ChatPanel />);
    expect(screen.getByText(/Second message/)).toBeInTheDocument();
  });
});
