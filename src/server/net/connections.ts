import WebSocket from 'ws';

export const playersWsMap = new Map<string, WebSocket>();

/** The auth epoch each socket was opened under; a later epoch revokes it. */
export const socketEpochs = new WeakMap<WebSocket, number>();

/** Closes `username`'s socket if it predates `epoch`; whether it did. */
export function closeRevokedSocket(username: string, epoch: number): boolean {
  const ws = playersWsMap.get(username);
  if (!ws || (socketEpochs.get(ws) ?? 0) >= epoch) return false;
  ws.close(1008, 'Session revoked');
  return true;
}

// An entry is added on the authenticated handshake, so an open socket is a
// player online. Sockets already closed can linger in the map until the close
// handler runs, which is why every reader filters instead of taking `size`.
export const openConnectionCount = (): number =>
  [...playersWsMap.values()].filter((ws) => ws.readyState === WebSocket.OPEN)
    .length;
