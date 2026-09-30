import { describe, it, expect, vi } from 'vitest';
import { Key } from '../../../shared/types';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeSocket;
  readyState = FakeSocket.CONNECTING;
  sent: { type: string; channel?: string }[] = [];
  onopen?: () => void;
  constructor() {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as { type: string });
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
}

describe('sendAction before the socket is open', () => {
  it('holds a module request until the open, and drops a step', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const { initializeWebSocket, sendAction } = await import('./wsManager');

    sendAction({ type: 'custom', channel: 'quest:request' });
    sendAction({
      type: 'keyboard',
      keyboardAction: { key: Key.ArrowUp, type: 'press' },
    });
    initializeWebSocket('ws://test/ws');
    sendAction({ type: 'custom', channel: 'magic:request' });

    const socket = FakeSocket.last;
    expect(socket.sent).toEqual([]);
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();

    expect(socket.sent.map((a) => a.channel ?? a.type)).toEqual([
      'language',
      'quest:request',
      'magic:request',
    ]);
    vi.unstubAllGlobals();
  });
});
