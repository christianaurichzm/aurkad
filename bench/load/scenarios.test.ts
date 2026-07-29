import { describe, it, expect } from 'vitest';
import { SCENARIOS, findScenario } from './scenarios.js';

describe('scenario catalogue', () => {
  it('covers the load scenarios from the benchmark plan', () => {
    const ids = SCENARIOS.map((s) => s.id);
    for (const id of ['L1', 'L2', 'L3', 'L4', 'L6', 'L7']) {
      expect(ids).toContain(id);
    }
  });

  it('has no duplicate ids', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes every scenario with something to watch', () => {
    for (const s of SCENARIOS) {
      expect(s.watch.length).toBeGreaterThan(0);
      expect(s.bots).toBeGreaterThan(0);
      expect(s.durationSeconds).toBeGreaterThan(0);
    }
  });

  it('looks a scenario up regardless of case', () => {
    expect(findScenario('l3')?.id).toBe('L3');
    expect(findScenario('L3')?.id).toBe('L3');
    expect(findScenario('nope')).toBeUndefined();
  });

  // L3 is the one that decides whether a binary protocol is worth building.
  it('keeps L3 a large single crowd that wanders', () => {
    const l3 = findScenario('L3')!;
    expect(l3.bots).toBeGreaterThanOrEqual(500);
    expect(l3.behavior).toBe('wander');
  });
});
