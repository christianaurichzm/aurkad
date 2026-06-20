import { config } from '../config.js';

let currentTick = 0;

export function advanceTick() {
  currentTick++;
}

export function resetClock() {
  currentTick = 0;
}

export function getTick(): number {
  return currentTick;
}

export function msToTicks(ms: number): number {
  const tickInterval = 1000 / config.gameLoop.tickRate;
  return Math.ceil(ms / tickInterval);
}
