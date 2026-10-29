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
  onclose?: () => void;
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

describe('reconnecting after the server went away', () => {
  it('draws the wait, so clients dropped together come back apart', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const { initializeWebSocket } = await import('./wsManager');

    const waitAfterClose = (draw: number) => {
      vi.spyOn(Math, 'random').mockReturnValue(draw);
      initializeWebSocket('ws://test/ws');
      const dropped = FakeSocket.last;
      dropped.readyState = FakeSocket.OPEN;
      dropped.onopen?.();
      dropped.onclose?.();
      let waited = 0;
      while (FakeSocket.last === dropped && waited < 2000) {
        vi.advanceTimersByTime(50);
        waited += 50;
      }
      return waited;
    };

    expect(waitAfterClose(0)).toBe(500);
    expect(waitAfterClose(0.9)).toBe(950);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe('a socket replaced by a redirect', () => {
  it('leaves the new connection alone when the old one reports its close late', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { initializeWebSocket } = await import('./wsManager');

    initializeWebSocket('ws://test/ws');
    const old = FakeSocket.last;
    old.onmessage?.({
      data: JSON.stringify({ type: 'redirect', url: 'ws://b.test/ws' }),
    });
    vi.advanceTimersByTime(200);
    const next = FakeSocket.last;
    next.readyState = FakeSocket.OPEN;
    next.onopen?.();
    old.onclose?.();
    vi.runAllTimers();

    expect(FakeSocket.last).toBe(next);
    expect(next.readyState).toBe(FakeSocket.OPEN);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe('the connection status on open', () => {
  it('says Connected only when coming back from a drop', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const { initializeWebSocket } = await import('./wsManager');
    const { useUIStore } = await import('../../stores/uiStore');
    const status = () => useUIStore.getState().connectionStatus;
    const open = () => {
      FakeSocket.last.readyState = FakeSocket.OPEN;
      FakeSocket.last.onopen?.();
    };

    initializeWebSocket('ws://test/ws');
    open();
    expect(status().visible).toBe(false);

    FakeSocket.last.onclose?.();
    vi.runOnlyPendingTimers();
    open();
    expect(status()).toMatchObject({ visible: true, message: 'Connected' });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
