import { describe, it, expect, beforeEach } from 'vitest';
import { en } from './en';
import { pt } from './pt';
import { getLanguage, setLanguage, t, LANGUAGES } from './index';

beforeEach(() => {
  setLanguage('en');
});

describe('translation tables', () => {
  // The types enforce this already; the test keeps a table added as a plain
  // object from skipping it.
  it('every language answers every key English declares', () => {
    const keys = Object.keys(en);

    for (const [code, table] of Object.entries({ en, pt })) {
      expect(Object.keys(table).sort(), code).toEqual(keys.sort());
    }
  });

  it('carries no empty string, which would render as a blank label', () => {
    for (const [code, table] of Object.entries({ en, pt })) {
      for (const [key, value] of Object.entries(table)) {
        expect(value.trim(), `${code}:${key}`).not.toBe('');
      }
    }
  });

  // A placeholder that exists in one language and not another is a sentence
  // that loses its number when the player switches.
  it('keeps the same placeholders in every language', () => {
    const holders = (text: string) =>
      (text.match(/\{(\w+)\}/g) ?? []).sort().join(',');

    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(holders(pt[key]), key).toBe(holders(en[key]));
    }
  });

  it('offers a table for every language it lists', () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual(['en', 'pt']);
  });
});

describe('t', () => {
  it('returns the string for the active language', () => {
    expect(t('actions.inventory')).toBe('Inventory');

    setLanguage('pt');

    expect(t('actions.inventory')).toBe('Inventário');
  });

  it('fills placeholders', () => {
    expect(t('hud.level', { level: 7 })).toBe('Level 7');
    expect(t('hud.xp', { current: 30, max: 100 })).toBe('XP 30/100');
  });

  it('leaves a placeholder alone when nothing was passed for it', () => {
    expect(t('hud.level')).toBe('Level {level}');
    expect(t('hud.xp', { current: 5 })).toBe('XP 5/{max}');
  });

  it('remembers the language across calls', () => {
    setLanguage('pt');

    expect(getLanguage()).toBe('pt');
    expect(t('common.close')).toBe('Fechar');
  });

  // Half-translated is a normal state mid-translation, and a player should
  // read the English sentence rather than the key.
  it('falls back to English rather than showing a key', () => {
    setLanguage('pt');
    const table = pt as Record<string, string>;
    const original = table['common.save'];
    table['common.save'] = '';

    expect(t('common.save')).toBe('Save');

    table['common.save'] = original!;
  });
});
