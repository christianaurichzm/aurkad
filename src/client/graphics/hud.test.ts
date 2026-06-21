import { describe, it, expect } from 'vitest';
import { getHealthBarInfo, getPlayerHudText } from './hud';

describe('getPlayerHudText', () => {
  it('renders level in parentheses without the level label', () => {
    expect(getPlayerHudText('Alice', 5)).toBe('Alice (5)');
  });
});

describe('getHealthBarInfo', () => {
  it('should return green color for 100% health', () => {
    const result = getHealthBarInfo(100, 100);

    expect(result.percentage).toBe(1);
    expect(result.color).toBe('green');
    expect(result.text).toBe('100%');
  });

  it('should return green color for 75% health', () => {
    const result = getHealthBarInfo(75, 100);

    expect(result.percentage).toBe(0.75);
    expect(result.color).toBe('green');
    expect(result.text).toBe('75%');
  });

  it('should return green color for 51% health', () => {
    const result = getHealthBarInfo(51, 100);

    expect(result.percentage).toBe(0.51);
    expect(result.color).toBe('green');
    expect(result.text).toBe('51%');
  });

  it('should return yellow color for 50% health', () => {
    const result = getHealthBarInfo(50, 100);

    expect(result.percentage).toBe(0.5);
    expect(result.color).toBe('yellow');
    expect(result.text).toBe('50%');
  });

  it('should return yellow color for 30% health', () => {
    const result = getHealthBarInfo(30, 100);

    expect(result.percentage).toBe(0.3);
    expect(result.color).toBe('yellow');
    expect(result.text).toBe('30%');
  });

  it('should return yellow color for 21% health', () => {
    const result = getHealthBarInfo(21, 100);

    expect(result.percentage).toBe(0.21);
    expect(result.color).toBe('yellow');
    expect(result.text).toBe('21%');
  });

  it('should return red color for 20% health', () => {
    const result = getHealthBarInfo(20, 100);

    expect(result.percentage).toBe(0.2);
    expect(result.color).toBe('red');
    expect(result.text).toBe('20%');
  });

  it('should return red color for 10% health', () => {
    const result = getHealthBarInfo(10, 100);

    expect(result.percentage).toBe(0.1);
    expect(result.color).toBe('red');
    expect(result.text).toBe('10%');
  });

  it('should return red color for 0% health', () => {
    const result = getHealthBarInfo(0, 100);

    expect(result.percentage).toBe(0);
    expect(result.color).toBe('red');
    expect(result.text).toBe('0%');
  });

  it('should handle different max health values', () => {
    const result = getHealthBarInfo(75, 150);

    expect(result.percentage).toBe(0.5);
    expect(result.color).toBe('yellow');
    expect(result.text).toBe('50%');
  });

  it('should handle overheal (current > max)', () => {
    const result = getHealthBarInfo(120, 100);

    expect(result.percentage).toBe(1);
    expect(result.color).toBe('green');
    expect(result.text).toBe('100%');
  });

  it('should handle negative health', () => {
    const result = getHealthBarInfo(-10, 100);

    expect(result.percentage).toBe(0);
    expect(result.color).toBe('red');
    expect(result.text).toBe('0%');
  });

  it('should round percentage correctly', () => {
    const result = getHealthBarInfo(33, 100);

    expect(result.percentage).toBe(0.33);
    expect(result.text).toBe('33%');
  });

  it('should handle decimal percentages', () => {
    const result = getHealthBarInfo(66.6, 100);

    expect(result.percentage).toBeCloseTo(0.666, 3);
    expect(result.text).toBe('67%');
  });
});
