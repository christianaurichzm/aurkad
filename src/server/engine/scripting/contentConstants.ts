import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { items, runtimeState } from '../../services/world/gameData.js';
import { getAllSpells } from '../../services/content/spellService.js';
import { getAllArrows } from '../../services/content/arrowService.js';
import { listNpcs } from '../../services/npc/index.js';
import { logger } from '../../logger.js';

// Typed content constants for scripts and modules, so game code names
// content (`giveItem(player, Items.SteelSword)`) instead of raw ids. One
// source feeds the sandbox globals (Items, Npcs, ...) and
// `scripts/content.generated.d.ts` for autocomplete; both are rebuilt at
// boot and, debounced, whenever content changes.

type Entry = { id: string | number; name: string };
type ConstMap = Record<string, string | number>;

export interface ContentConstants {
  Items: ConstMap;
  Npcs: ConstMap;
  Maps: ConstMap;
  Spells: ConstMap;
  Arrows: ConstMap;
}

const empty = (): ContentConstants => ({
  Items: {},
  Npcs: {},
  Maps: {},
  Spells: {},
  Arrows: {},
});

let current: ContentConstants = empty();

// A content name -> a safe PascalCase JS identifier. Empty string if the name
// has no usable characters (caller falls back to a prefixed id).
export function toIdentifier(name: string): string {
  const parts = String(name ?? '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  let id = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
  if (!id) return '';
  if (/^[0-9]/.test(id)) id = '_' + id;
  return id;
}

// Build a { identifier: id } map, deterministic and collision-safe. Sorted by
// id so output is stable; a name clash keeps the first and suffixes later ones
// with their id; an unusable name falls back to `${prefix}${id}`.
export function buildConstants(entries: Entry[], prefix: string): ConstMap {
  const out: ConstMap = {};
  const used = new Set<string>();
  const sorted = [...entries].sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
  );
  for (const e of sorted) {
    let key = toIdentifier(e.name) || `${prefix}${e.id}`;
    if (used.has(key)) key = `${key}_${e.id}`;
    if (used.has(key)) continue;
    used.add(key);
    out[key] = e.id;
  }
  return out;
}

export async function rebuildContentConstants(): Promise<void> {
  const npcs = await listNpcs().catch((e) => {
    logger.error('[content] listNpcs failed while building constants', {
      err: e,
    });
    return [] as Array<{ id: string; name: string }>;
  });

  const next: ContentConstants = {
    Items: buildConstants(
      [...items.values()].map((i) => ({ id: i.id, name: i.name })),
      'Item',
    ),
    Npcs: buildConstants(
      npcs.map((n) => ({ id: n.id, name: n.name })),
      'Npc',
    ),
    Maps: buildConstants(
      Object.values(runtimeState.maps).map((m) => ({ id: m.id, name: m.name })),
      'Map',
    ),
    Spells: buildConstants(
      getAllSpells().map((s) => ({ id: s.id, name: s.name })),
      'Spell',
    ),
    Arrows: buildConstants(
      getAllArrows().map((a) => ({ id: a.id, name: a.name })),
      'Arrow',
    ),
  };
  for (const k of Object.keys(next) as (keyof ContentConstants)[]) {
    Object.freeze(next[k]);
  }
  current = next;
}

export function getContentConstants(): ContentConstants {
  return current;
}

function categoryDts(name: string, map: ConstMap): string {
  const keys = Object.keys(map).sort();
  if (keys.length === 0) return `declare const ${name}: {};`;
  const lines = keys.map(
    (k) =>
      `  readonly ${k}: ${typeof map[k] === 'number' ? 'number' : 'string'};`,
  );
  return `declare const ${name}: {\n${lines.join('\n')}\n};`;
}

export function renderContentDts(c: ContentConstants = current): string {
  const header = [
    '// AUTO-GENERATED from your game content - do not edit by hand.',
    '// Regenerated at server boot and when content changes. Reference content',
    '// by name with autocomplete, e.g. `Items.SteelSword` instead of a raw id.',
    '',
  ].join('\n');
  const blocks = [
    categoryDts('Items', c.Items),
    categoryDts('Npcs', c.Npcs),
    categoryDts('Maps', c.Maps),
    categoryDts('Spells', c.Spells),
    categoryDts('Arrows', c.Arrows),
  ];
  return `${header}${blocks.join('\n')}\n`;
}

// Writes the .d.ts next to the game scripts for the editor. Best effort: a
// read-only mount (docker `scripts:ro`) only loses autocomplete, and the
// runtime constants still work.
export function writeContentDts(
  dir = path.join(process.cwd(), 'scripts'),
): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'content.generated.d.ts'), renderContentDts());
  } catch (e) {
    logger.warn('[content] could not write content.generated.d.ts', { err: e });
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

// Debounced rebuild+write, called after admin content edits so a burst of saves
// coalesces into one regeneration.
export function scheduleContentRefresh(delayMs = 800): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    rebuildContentConstants()
      .then(() => writeContentDts())
      .catch((e) => logger.error('[content] refresh failed', { err: e }));
  }, delayMs);
  refreshTimer.unref?.();
}
