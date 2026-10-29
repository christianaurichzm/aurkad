import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { en } from './en';
import { pt } from './pt';
import {
  getLanguage,
  moduleText,
  registerModuleStrings,
  setLanguage,
  t,
  LANGUAGES,
} from './index';

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
    expect(t('quest.progress', { current: 30, target: 100 })).toBe('30/100');
  });

  it('leaves a placeholder alone when nothing was passed for it', () => {
    expect(t('hud.level')).toBe('Level {level}');
    expect(t('quest.progress', { current: 5 })).toBe('5/{target}');
  });

  it('remembers the language across calls', () => {
    setLanguage('pt');

    expect(getLanguage()).toBe('pt');
    expect(t('common.cancel')).toBe('Cancelar');
  });

  it('marks the page with the language it is in', () => {
    setLanguage('pt');
    expect(document.documentElement.lang).toBe('pt');

    setLanguage('en');
    expect(document.documentElement.lang).toBe('en');
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

describe('module strings', () => {
  beforeEach(() => {
    registerModuleStrings({
      pt: {
        Guild: 'Guilda',
        'Quests ({count} active)': 'Missões ({count} ativas)',
      },
    });
  });

  it('translates by the English the module already drew', () => {
    setLanguage('pt');

    expect(moduleText('Guild')).toBe('Guilda');
  });

  // The key is the fallback, so a module that ships one language still reads.
  it('returns the English itself when no table answers it', () => {
    setLanguage('pt');

    expect(moduleText('Leave Guild')).toBe('Leave Guild');

    setLanguage('en');

    expect(moduleText('Guild')).toBe('Guild');
  });

  it('fills placeholders like the core table does', () => {
    setLanguage('pt');

    expect(moduleText('Quests ({count} active)', { count: 3 })).toBe(
      'Missões (3 ativas)',
    );
  });
});

// The other half of the jsx-no-literals rule: that catches a hardcoded
// sentence, this catches a key nothing renders.
describe('the table and the screens agree', () => {
  const source = fs
    .readdirSync(path.join(process.cwd(), 'src/client'), {
      recursive: true,
      encoding: 'utf-8',
    })
    .filter((file) => /\.tsx?$/.test(file) && !file.startsWith('i18n/'))
    .map((file) =>
      fs.readFileSync(path.join(process.cwd(), 'src/client', file), 'utf-8'),
    )
    .join('\n');

  it('renders every key it declares', () => {
    const unused = Object.keys(en).filter(
      (key) => !source.includes(`'${key}'`),
    );

    expect(unused).toEqual([]);
  });
});
