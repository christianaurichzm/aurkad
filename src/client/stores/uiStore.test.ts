import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

describe('UIStore - Map Editor State', () => {
  beforeEach(() => {
    useUIStore.setState({ mapEdited: false });
  });

  it('should have initial mapEdited as false', () => {
    const state = useUIStore.getState();
    expect(state.mapEdited).toBe(false);
  });

  it('should set mapEdited to true', () => {
    const { setMapEdited } = useUIStore.getState();
    setMapEdited(true);
    expect(useUIStore.getState().mapEdited).toBe(true);
  });

  it('should set mapEdited to false', () => {
    const { setMapEdited } = useUIStore.getState();
    setMapEdited(true);
    setMapEdited(false);
    expect(useUIStore.getState().mapEdited).toBe(false);
  });
});

describe('UIStore - Connection Status', () => {
  beforeEach(() => {
    useUIStore.setState({
      connectionStatus: {
        message: '',
        isError: false,
        visible: false,
      },
    });
  });

  it('should have initial connection status hidden', () => {
    const { connectionStatus } = useUIStore.getState();
    expect(connectionStatus.visible).toBe(false);
    expect(connectionStatus.message).toBe('');
    expect(connectionStatus.isError).toBe(false);
  });

  it('should show connection status with success message', () => {
    const { showConnectionStatus } = useUIStore.getState();
    showConnectionStatus('Connected successfully');

    const { connectionStatus } = useUIStore.getState();
    expect(connectionStatus.visible).toBe(true);
    expect(connectionStatus.message).toBe('Connected successfully');
    expect(connectionStatus.isError).toBe(false);
  });

  it('should show connection status with error message', () => {
    const { showConnectionStatus } = useUIStore.getState();
    showConnectionStatus('Connection failed', true);

    const { connectionStatus } = useUIStore.getState();
    expect(connectionStatus.visible).toBe(true);
    expect(connectionStatus.message).toBe('Connection failed');
    expect(connectionStatus.isError).toBe(true);
  });

  it('should hide connection status', () => {
    const { showConnectionStatus, hideConnectionStatus } =
      useUIStore.getState();

    showConnectionStatus('Test message');
    expect(useUIStore.getState().connectionStatus.visible).toBe(true);

    hideConnectionStatus();
    expect(useUIStore.getState().connectionStatus.visible).toBe(false);
  });

  it('should preserve message when hiding', () => {
    const { showConnectionStatus, hideConnectionStatus } =
      useUIStore.getState();

    showConnectionStatus('Test message', true);
    hideConnectionStatus();

    const { connectionStatus } = useUIStore.getState();
    expect(connectionStatus.visible).toBe(false);
    expect(connectionStatus.message).toBe('Test message');
    expect(connectionStatus.isError).toBe(true);
  });
});

describe('UIStore - Player Health', () => {
  beforeEach(() => {
    useUIStore.setState({
      playerHealth: {
        current: 100,
        max: 100,
      },
    });
  });

  it('should have initial health at 100/100', () => {
    const { playerHealth } = useUIStore.getState();
    expect(playerHealth.current).toBe(100);
    expect(playerHealth.max).toBe(100);
  });

  it('should update player health', () => {
    const { setPlayerHealth } = useUIStore.getState();
    setPlayerHealth(75, 100);

    const { playerHealth } = useUIStore.getState();
    expect(playerHealth.current).toBe(75);
    expect(playerHealth.max).toBe(100);
  });

  it('should update max health', () => {
    const { setPlayerHealth } = useUIStore.getState();
    setPlayerHealth(120, 150);

    const { playerHealth } = useUIStore.getState();
    expect(playerHealth.current).toBe(120);
    expect(playerHealth.max).toBe(150);
  });

  it('should handle zero health', () => {
    const { setPlayerHealth } = useUIStore.getState();
    setPlayerHealth(0, 100);

    const { playerHealth } = useUIStore.getState();
    expect(playerHealth.current).toBe(0);
  });
});

describe('UIStore - Chat State', () => {
  beforeEach(() => {
    useUIStore.setState({
      chat: {
        messages: [],
        inputValue: '',
        scope: 'map',
      },
    });
  });

  it('should have empty chat initially', () => {
    const { chat } = useUIStore.getState();
    expect(chat.messages).toEqual([]);
    expect(chat.inputValue).toBe('');
    expect(chat.scope).toBe('map');
  });

  it('should add chat message', () => {
    const { addChatMessage } = useUIStore.getState();

    addChatMessage({
      type: 'chat',
      scope: 'map',
      message: 'Hello world',
      username: 'TestUser',
    });

    const { chat } = useUIStore.getState();
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].message).toBe('Hello world');
    expect(chat.messages[0].username).toBe('TestUser');
  });

  it('should add multiple chat messages in order', () => {
    const { addChatMessage } = useUIStore.getState();

    addChatMessage({ type: 'chat', scope: 'map', message: 'First' });
    addChatMessage({ type: 'chat', scope: 'map', message: 'Second' });
    addChatMessage({ type: 'chat', scope: 'global', message: 'Third' });

    const { chat } = useUIStore.getState();
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[0].message).toBe('First');
    expect(chat.messages[1].message).toBe('Second');
    expect(chat.messages[2].message).toBe('Third');
  });

  it('should update chat input value', () => {
    const { setChatInput } = useUIStore.getState();
    setChatInput('Hello');

    expect(useUIStore.getState().chat.inputValue).toBe('Hello');
  });

  it('should update chat scope', () => {
    const { setChatScope } = useUIStore.getState();
    setChatScope('global');

    expect(useUIStore.getState().chat.scope).toBe('global');
  });

  it('should clear chat input', () => {
    const { setChatInput, clearChatInput } = useUIStore.getState();

    setChatInput('Test message');
    expect(useUIStore.getState().chat.inputValue).toBe('Test message');

    clearChatInput();
    expect(useUIStore.getState().chat.inputValue).toBe('');
  });

  it('should preserve messages when clearing input', () => {
    const { addChatMessage, setChatInput, clearChatInput } =
      useUIStore.getState();

    addChatMessage({ type: 'chat', scope: 'map', message: 'Test' });
    setChatInput('New message');
    clearChatInput();

    const { chat } = useUIStore.getState();
    expect(chat.messages).toHaveLength(1);
    expect(chat.inputValue).toBe('');
  });
});

describe('UIStore - Dialog State', () => {
  beforeEach(() => {
    useUIStore.setState({
      dialog: {
        visible: false,
        title: '',
        message: '',
        kind: 'info',
        confirmLabel: 'OK',
        cancelLabel: 'Cancel',
      },
    });
  });

  it('should show an error dialog with default labels', () => {
    void useUIStore.getState().showDialog({
      title: 'Purchase failed',
      message: 'Not enough coins',
      kind: 'error',
    });

    const { dialog } = useUIStore.getState();
    expect(dialog.visible).toBe(true);
    expect(dialog.title).toBe('Purchase failed');
    expect(dialog.message).toBe('Not enough coins');
    expect(dialog.kind).toBe('error');
    expect(dialog.confirmLabel).toBe('OK');
    expect(dialog.cancelLabel).toBe('Cancel');
    useUIStore.getState().closeDialog(true);
  });

  it('should resolve true when confirmed', async () => {
    const result = useUIStore.getState().showDialog({
      title: 'Reload',
      message: 'Reload the page?',
      kind: 'confirm',
      confirmLabel: 'Reload',
      cancelLabel: 'Stay',
    });

    useUIStore.getState().closeDialog(true);

    await expect(result).resolves.toBe(true);
    expect(useUIStore.getState().dialog.visible).toBe(false);
  });

  it('should resolve false when cancelled', async () => {
    const result = useUIStore.getState().showDialog({
      title: 'Discard changes?',
      message: 'You have unsaved changes.',
      kind: 'confirm',
    });

    useUIStore.getState().closeDialog(false);

    await expect(result).resolves.toBe(false);
    expect(useUIStore.getState().dialog.visible).toBe(false);
  });
});
