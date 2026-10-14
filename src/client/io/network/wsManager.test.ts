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
  onmessage?: (event: { data: string }) => void;
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
    const opened = vi.fn();
    window.addEventListener('socketOpen', opened);
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
    window.removeEventListener('socketOpen', opened);

    // What the keyboard listens for to say the keys still held.
    expect(opened).toHaveBeenCalledOnce();

    expect(socket.sent.map((a) => a.channel ?? a.type)).toEqual([
      'language',
      'quest:request',
      'magic:request',
    ]);
    vi.unstubAllGlobals();
  });
});

describe('a redirect to another instance', () => {
  it('sends the HTTP calls where the socket went', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetch);
    const { initializeWebSocket } = await import('./wsManager');
    const { httpClient } = await import('./http/httpClient');

    initializeWebSocket('ws://test/ws');
    FakeSocket.last.onmessage?.({
      data: JSON.stringify({
        type: 'redirect',
        url: 'wss://b.example.com:8443/ws',
      }),
    });
    await httpClient('/assign-points', { method: 'POST' });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://b.example.com:8443/assign-points',
    );
    vi.unstubAllGlobals();
  });
});
