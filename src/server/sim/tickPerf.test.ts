import { describe, it, expect } from 'vitest';
import { createFixture } from './simFixture.js';
import { Key } from '../../shared/types.js';

describe('tick performance gate', () => {
  it('runs 500 ticks with 20 players in under 5000ms', () => {
    const { addPlayer, step, press } = createFixture(0);

    for (let i = 0; i < 20; i++) {
      const p = addPlayer({ position: { x: (i + 1) * 64, y: 64 } });
      press(p.name, Key.ArrowRight);
    }

    const start = Date.now();
    step(500);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});
