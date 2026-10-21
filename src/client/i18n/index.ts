import { useSyncExternalStore } from 'react';
import { en, type TranslationKey } from './en';
import { pt } from './pt';

/**
 * Client translation with no library: a table per language and a lookup.
 * Plurals, gender and ICU can come when a game needs them, since the keys
 * are what matter. `Intl` covers numbers and dates.
 */

export const LANGUAGES = { en: 'English', pt: 'Português' } as const;

export type Language = keyof typeof LANGUAGES;

const TABLES: Record<Language, Record<TranslationKey, string>> = { en, pt };

const STORAGE_KEY = 'engine.language';

function detect(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in LANGUAGES) return stored as Language;
  } catch {
    // Storage disabled (private mode): fall through to the browser's own.
  }
  const browser = navigator.language.slice(0, 2);
  return browser in LANGUAGES ? (browser as Language) : 'en';
}

let language: Language = detect();
// What a screen reader picks its voice by, and what the browser's own offer to
// translate the page reads.
document.documentElement.lang = language;

const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return language;
}

export function setLanguage(next: Language): void {
  if (next === language) return;
  language = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Same as above: it applies to this session either way.
  }
  listeners.forEach((notify) => notify());
}

/** Anything holding translated text on screen; returns an unsubscribe. */
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Looks up a key and fills its `{placeholders}`, falling back to English
 * rather than showing the key.
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  return fill(TABLES[language][key] || en[key], params);
}

/**
 * Strings a module's browser half draws, keyed by the English itself. With
 * no typed table to catch a misspelled key, the worst case is the English
 * label. Module tables merge, so two modules share one translation of a word.
 */
const moduleTables: Record<Language, Record<string, string>> = {
  en: {},
  pt: {},
};

export function registerModuleStrings(
  tables: Partial<Record<Language, Record<string, string>>>,
): void {
  for (const [code, table] of Object.entries(tables)) {
    if (code in moduleTables) {
      Object.assign(moduleTables[code as Language], table);
    }
  }
  // Re-applies tables to text already on screen, so a table declared after
  // drawing still works.
  listeners.forEach((notify) => notify());
}

export function moduleText(
  text: string,
  params?: Record<string, string | number>,
): string {
  return fill(moduleTables[language][text] || text, params);
}

/**
 * The same `t` for components that re-render on a language change; a new
 * function per language so dependency arrays notice.
 */
export function useT(): typeof t {
  useSyncExternalStore(onLanguageChange, getLanguage, () => 'en');
  return t;
}

/** `useT` for a module's React UI, over the tables keyed by the English. */
export function useModuleText(): typeof moduleText {
  useSyncExternalStore(onLanguageChange, getLanguage, () => 'en');
  return moduleText;
}

export type { TranslationKey };
