import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel, ChatPeek } from './ChatPanel';
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

  // An empty log says so instead of showing a blank panel.
  it('says the log is empty instead of rendering nothing', () => {
    render(<ChatPanel />);

    const chatBox = document.getElementById('chatBox');
    expect(chatBox).toBeInTheDocument();
    expect(chatBox?.querySelectorAll('.chat-empty')).toHaveLength(1);
    expect(
      chatBox?.querySelectorAll('.chat-global, .chat-map, .chat-player'),
    ).toHaveLength(0);
  });

  it('unfolds and folds back through its button, which says which it will do', async () => {
    render(<ChatPanel />);
    const chat = screen.getByRole('region', { name: 'Chat' });

    const expand = screen.getByRole('button', { name: 'Expand chat' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(expand);

    expect(chat).toHaveClass('is-expanded');
    await userEvent.click(
      screen.getByRole('button', { name: 'Collapse chat' }),
    );
    expect(chat).not.toHaveClass('is-expanded');
  });

  it('should render input and scope selector', () => {
    render(<ChatPanel />);

    const input = screen.getByPlaceholderText('Type a message…');
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

    const input = screen.getByPlaceholderText('Type a message…');

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

    expect(screen.getByText('TestUser')).toHaveClass('chat-who');
    expect(screen.getByText('TestUser').parentElement).toHaveTextContent(
      'TestUser: Hello',
    );
  });

  it('shows one channel under its tab and all of them under All', async () => {
    const user = userEvent.setup();
    useUIStore.setState({
      chat: {
        messages: [
          { type: 'chat', scope: 'map', message: 'nearby', username: 'A' },
          { type: 'chat', scope: 'global', message: 'everyone', username: 'B' },
          { type: 'chat', scope: 'player', message: 'Unknown command: /x' },
        ],
        inputValue: '',
        scope: 'map',
      },
    });
    render(<ChatPanel />);

    await user.click(screen.getByRole('tab', { name: 'System' }));
    expect(screen.getByText('Unknown command: /x')).toBeInTheDocument();
    expect(screen.queryByText(/nearby|everyone/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Global' }));
    expect(screen.getByText(/everyone/)).toBeInTheDocument();
    expect(screen.queryByText(/nearby/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.getByText(/nearby/)).toBeInTheDocument();
    expect(screen.getByText(/everyone/)).toBeInTheDocument();
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

  it('peeks at the last lines and opens the menu when touched', async () => {
    useUIStore.setState({
      chat: {
        messages: Array.from({ length: 20 }, (_, i) => ({
          username: 'Vesper',
          message: `line ${i}`,
          scope: 'map' as const,
          type: 'chat' as const,
        })),
        inputValue: '',
        scope: 'map',
      },
    });
    const onOpen = vi.fn();
    render(<ChatPeek onOpen={onOpen} />);

    const peek = screen.getByRole('button', { name: 'Chat' });
    expect(peek).toHaveTextContent('line 19');
    expect(peek).not.toHaveTextContent('line 0');
    await userEvent.click(peek);

    expect(onOpen).toHaveBeenCalledOnce();
  });
});
