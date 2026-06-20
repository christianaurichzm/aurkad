import { getRuntimeState } from './gameData.js';
import { playersWsMap } from './net/connections.js';

export interface TickMetrics {
  tickMs: number;
  queueSize: number;
}

const WINDOW = 100;
const tickWindow: TickMetrics[] = [];

export function recordTick(ms: number, queueSize: number): void {
  if (tickWindow.length >= WINDOW) tickWindow.shift();
  tickWindow.push({ tickMs: ms, queueSize });
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

  const avgTickMs =
    tickWindow.length === 0
      ? 0
      : tickWindow.reduce((s, t) => s + t.tickMs, 0) / tickWindow.length;

  const avgQueueSize =
    tickWindow.length === 0
      ? 0
      : tickWindow.reduce((s, t) => s + t.queueSize, 0) / tickWindow.length;

  return {
    uptime: Math.floor(process.uptime()),
    wsConnections: playersWsMap.size,
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
