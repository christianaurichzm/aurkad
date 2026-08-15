import WebSocket from 'ws';

export const playersWsMap = new Map<string, WebSocket>();

// An entry is added on the authenticated handshake, so an open socket is a
// player online. Sockets already closed can linger in the map until the close
// handler runs, which is why every reader filters instead of taking `size`.
export const openConnectionCount = (): number =>
  [...playersWsMap.values()].filter((ws) => ws.readyState === WebSocket.OPEN)
    .length;
