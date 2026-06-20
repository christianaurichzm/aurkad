import { describe, it, expect, beforeEach } from 'vitest';
import {
  tryConsumeAttackCooldown,
  clearAttackCooldown,
} from './attackCooldown.js';

beforeEach(() => {
  clearAttackCooldown('a');
});

describe('attack cooldown', () => {
  it('allows the first attack and blocks until the cooldown elapses', () => {
    // 250ms at 20Hz (50ms/tick) = 5 ticks
    expect(tryConsumeAttackCooldown('a', 0)).toBe(true);
    expect(tryConsumeAttackCooldown('a', 4)).toBe(false);
    expect(tryConsumeAttackCooldown('a', 5)).toBe(true);
    expect(tryConsumeAttackCooldown('a', 9)).toBe(false);
  });

  it('tracks ids independently', () => {
    expect(tryConsumeAttackCooldown('a', 0)).toBe(true);
    expect(tryConsumeAttackCooldown('b', 0)).toBe(true);
  });
});
