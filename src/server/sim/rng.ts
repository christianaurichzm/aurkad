// Deterministic PRNG (mulberry32) for the simulation. Given a seed the whole
// sequence is reproducible, which makes the sim replayable and testable. The
// default seed is non-deterministic so drops/spawns aren't predictable in
// production; tests and replay call seedRng with a fixed value.
let state = Date.now() >>> 0;

export function seedRng(seed: number): void {
  state = seed >>> 0;
}

export function nextRandom(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(maxExclusive: number): number {
  return Math.floor(nextRandom() * maxExclusive);
}

export function randomChance(percent: number): boolean {
  return nextRandom() * 100 <= percent;
}

export function randomPick<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[randomInt(items.length)];
}
