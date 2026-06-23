import { WebSocket } from 'ws';
import { getRuntimeState } from './gameData.js';
import { playersWsMap } from './net/connections.js';

export interface TickMetrics {
  tickMs: number;
  queueSize: number;
}

const WINDOW = 100;
const tickWindow: TickMetrics[] = Array.from({ length: WINDOW }, () => ({
  tickMs: 0,
  queueSize: 0,
}));
let tickHead = 0;
let tickFilled = 0;

export function recordTick(ms: number, queueSize: number): void {
  tickWindow[tickHead] = { tickMs: ms, queueSize };
  tickHead = (tickHead + 1) % WINDOW;
  if (tickFilled < WINDOW) tickFilled++;
}

export function getMetrics() {
  const state = getRuntimeState();
  const maps = Object.values(state.maps);

  let totalPlayers = 0;
  let totalNpcs = 0;
  for (const map of maps) {
    totalPlayers += Object.keys(map.players).length;
    totalNpcs += Object.keys(map.npcs).length;
  }

  let sumTickMs = 0;
  let sumQueueSize = 0;
  for (let i = 0; i < tickFilled; i++) {
    sumTickMs += tickWindow[i]!.tickMs;
    sumQueueSize += tickWindow[i]!.queueSize;
  }

  const avgTickMs = tickFilled === 0 ? 0 : sumTickMs / tickFilled;
  const avgQueueSize = tickFilled === 0 ? 0 : sumQueueSize / tickFilled;

  return {
    uptime: Math.floor(process.uptime()),
    wsConnections: [...playersWsMap.values()].filter(
      (ws) => ws.readyState === WebSocket.OPEN,
    ).length,
    players: totalPlayers,
    npcs: totalNpcs,
    maps: maps.length,
    tick: {
      samples: tickWindow.length,
      avgMs: Math.round(avgTickMs * 100) / 100,
      avgQueueSize: Math.round(avgQueueSize * 10) / 10,
    },
  };
}
