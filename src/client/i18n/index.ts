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

const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return language;
}

export function setLanguage(next: Language): void {
  if (next === language) return;
  language = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Same as above: it applies to this session either way.
  }
  listeners.forEach((notify) => notify());
}

/**
 * Looks up a key and fills its `{placeholders}`, falling back to English
 * rather than showing the key.
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const text = TABLES[language][key] || en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * The same `t` for components that re-render on a language change; a new
 * function per language so dependency arrays notice.
 */
export function useT(): typeof t {
  useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    getLanguage,
    () => 'en',
  );
  return t;
}

export type { TranslationKey };
