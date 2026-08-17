import type { PlayerServer } from '../../shared/types.js';

/**
 * Translation for text the server sends to one player. Unlike the client's
 * tables, keyed by name and typed against English, this is module and script
 * text keyed by the English itself (modules/README.md), so a key nobody
 * translated degrades into the sentence the module wrote.
 *
 * Language is a session fact, not a saved one: the browser tells the server
 * on connect and on every switch, so one account can read Portuguese on one
 * machine and English on another.
 */

const DEFAULT_LANGUAGE = 'en';

const tables: Record<string, Record<string, string>> = {};

/**
 * Merge one module's tables in, keyed by language and then by the English.
 *
 * Merged rather than kept per module, so two modules cannot disagree about one
 * English sentence. For a command reply that is a feature: "Player not found."
 * should not depend on which module answered.
 */
export function registerStrings(
  next: Record<string, Record<string, string>>,
): void {
  for (const [language, table] of Object.entries(next)) {
    if (!table || typeof table !== 'object') continue;
    tables[language] = { ...tables[language], ...table };
  }
}

/** Test and reload helper; the tables are otherwise merge-only. */
export function clearStrings(): void {
  for (const language of Object.keys(tables)) delete tables[language];
}

/**
 * The English, in the player's language, with `{placeholders}` filled. A
 * broadcast or a REPL command has no player and reads the English.
 */
export function translate(
  player: PlayerServer | undefined,
  text: string,
  params?: Record<string, string | number>,
): string {
  const language = player?.language ?? DEFAULT_LANGUAGE;
  const translated = tables[language]?.[text] || text;
  if (!params) return translated;
  return translated.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
