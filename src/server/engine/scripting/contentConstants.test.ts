import { describe, it, expect } from 'vitest';
import {
  toIdentifier,
  buildConstants,
  renderContentDts,
} from './contentConstants.js';

describe('toIdentifier', () => {
  it('PascalCases and strips separators', () => {
    expect(toIdentifier('Health Potion')).toBe('HealthPotion');
    expect(toIdentifier('steel-sword')).toBe('SteelSword');
    expect(toIdentifier('Elder')).toBe('Elder');
  });

  it('prefixes a leading digit', () => {
    expect(toIdentifier('10mm Ammo')).toBe('_10mmAmmo');
  });

  it('returns empty for names with no usable characters', () => {
    expect(toIdentifier('')).toBe('');
    expect(toIdentifier('!!!')).toBe('');
  });
});

describe('buildConstants', () => {
  it('maps identifier -> id', () => {
    expect(
      buildConstants(
        [
          { id: 1, name: 'Health Potion' },
          { id: 8, name: 'Steel Sword' },
        ],
        'Item',
      ),
    ).toEqual({ HealthPotion: 1, SteelSword: 8 });
  });

  it('suffixes clashing names with their id, deterministically', () => {
    expect(
      buildConstants(
        [
          { id: 1, name: 'Sword' },
          { id: 2, name: 'Sword' },
        ],
        'Item',
      ),
    ).toEqual({ Sword: 1, Sword_2: 2 });
  });

  it('falls back to prefix+id for unusable names', () => {
    expect(buildConstants([{ id: 5, name: '???' }], 'Npc')).toEqual({
      Npc5: 5,
    });
  });
});

describe('renderContentDts', () => {
  it('declares typed const objects with number/string ids', () => {
    const dts = renderContentDts({
      Items: { SteelSword: 8 },
      Npcs: { Elder: 'elder1' },
      Maps: {},
      Spells: {},
      Arrows: {},
    });
    expect(dts).toContain('declare const Items: {');
    expect(dts).toContain('readonly SteelSword: number;');
    expect(dts).toContain('readonly Elder: string;');
    expect(dts).toContain('declare const Maps: {};');
  });
});
