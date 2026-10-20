import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { gamePath } from '../config.js';
import { logger } from '../logger.js';
import {
  BorderLinksSchema,
  MapTypeSchema,
  PvpMoraleSchema,
  TileSchema,
} from '../services/world/mapService.js';
import { ArrowSchema as ArrowFieldsSchema } from '../services/content/arrowService.js';
import { DialogSchema } from '../services/content/dialogService.js';
import { ItemSchema as ItemFieldsSchema } from '../services/content/itemService.js';
import { LootTableSchema } from '../services/content/lootTableService.js';
import { NpcSchema as NpcFieldsSchema } from '../services/content/npcService.js';
import { QuestSchema } from '../services/content/questService.js';
import { RecipeSchema } from '../services/content/recipeService.js';
import {
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  TILE_SIZE,
} from '../../shared/constants.js';
import {
  createOrUpdateItem,
  listItems,
} from '../services/content/itemService.js';
import { createOrUpdateNpc, listNpcs } from '../services/content/npcService.js';
import { createOrUpdateMap, listMaps } from '../services/world/mapService.js';
import {
  createOrUpdateShop,
  listShops,
  ShopSchema,
} from '../services/economy/shopService.js';
import {
  createOrUpdateLootTable,
  dropsToLootTable,
  listLootTables,
} from '../services/content/lootTableService.js';
import {
  createOrUpdateDialog,
  listDialogs,
} from '../services/content/dialogService.js';
import {
  createOrUpdateQuest,
  listQuests,
} from '../services/content/questService.js';
import {
  createOrUpdateRecipe,
  listRecipes,
} from '../services/content/recipeService.js';
import {
  createOrUpdateArrow,
  listArrows,
} from '../services/content/arrowService.js';
import {
  createOrUpdateSpell,
  listSpells,
  SpellSchema as SpellFieldsSchema,
} from '../services/content/spellService.js';
import { gameConfig } from '../gameConfig.js';
import {
  validateContentReferences,
  validateWorldGraph,
  validateScriptReferences,
} from '../services/content/contentValidation.js';
import { registeredBehaviors } from '../engine/scripting/entityScripts.js';
import { isProvided } from '../engine/modules/registry.js';
import {
  checkDatabaseSchemaVersion,
  raiseCounter,
} from '../services/dbService.js';

// Versionable game content lives as JSON files in content/. On boot it is
// upserted into MongoDB (files win for the ids they define), so a creator can
// fork the repo, edit files, and commit an entire game. Mongo remains the
// runtime source of truth; export snapshots the current DB back to files.

const contentDir = (): string =>
  process.env.CONTENT_PATH
    ? path.resolve(process.env.CONTENT_PATH)
    : gamePath('content');

const ItemSchema = ItemFieldsSchema.extend({
  // Not 0: an item saved without an id is given the next one, and 0 reads as
  // none, so an item 0 in a file would come in renumbered and every loot
  // table, shop and tile naming it would point at nothing.
  id: z.number().int().positive(),
});
const ArrowSchema = ArrowFieldsSchema.extend({
  id: z.number().int().positive(),
});
const SpellSchema = SpellFieldsSchema.extend({
  id: z.number().int().positive(),
});

// The editor's npc plus what only a file sets: the id, the size, the reach and
// the pre-loot-table drop list.
const NpcSchema = NpcFieldsSchema.extend({
  id: z.string().min(1),
  // One tile, like every other way an npc enters the world (seed, spawnNpc):
  // any other size draws a health bar out of proportion to its sprite and
  // leaves a melee npc unable to reach the tile next to it.
  width: z.number().int().positive().default(SPRITE_WIDTH),
  height: z.number().int().positive().default(SPRITE_HEIGHT),
  attackRange: z.number().int().positive().default(TILE_SIZE),
  // Still accepted, never written: a pack exported before loot tables carries
  // this, and the import turns it into a table of the npc's own (see the
  // upsert below). Exporting produces `lootTableId` and nothing else.
  itemsToDrop: z
    .array(
      z.object({
        itemId: z.number().int().nonnegative(),
        chance: z.number().min(0).max(1),
        quantity: z.number().int().positive().optional(),
      }),
    )
    .optional(),
});

const MapSchema = z.object({
  // createOrUpdateMap refuses a dungeon copy's id, and the import would only
  // find out after writing everything before the maps.
  id: z
    .string()
    .min(1)
    .regex(/^[^#]+$/, 'a # marks a dungeon copy, which is never saved'),
  name: z.string().min(1),
  type: MapTypeSchema,
  orientation: z.enum(['orthogonal', 'isometric']).optional(),
  pvp: PvpMoraleSchema.optional(),
  instanced: z.boolean().optional(),
  // What joins one map to the next. Undeclared here, `z.object` would drop it
  // between the file and the database and adjacent maps would arrive as
  // islands, though the model declares it.
  borderLinks: BorderLinksSchema,
  music: z.string().optional(),
  tiles: z.array(z.array(TileSchema)),
  droppedItems: z
    .array(
      z.object({
        itemId: z.number(),
        sprite: z.number(),
        quantity: z.number(),
        position: z.object({ x: z.number(), y: z.number() }),
      }),
    )
    .optional(),
});

type FileSpec<T extends z.ZodType> = {
  file: string;
  schema: T;
  upsert: (entry: z.output<T>) => Promise<unknown>;
  list: () => Promise<unknown[]>;
};

// Import order: arrows first (a ranged weapon names one), then items, loot
// tables (item ids), dialogs and quests, then npcs and shops (all of them),
// maps last (npc and item ids in tiles). Quests and npcs name each other,
// so quests go first: npc.questId is the reference a save would enforce.
export const SPECS = {
  arrows: {
    file: 'arrows.json',
    schema: ArrowSchema,
    upsert: (e) => createOrUpdateArrow(e),
    list: listArrows,
  } as FileSpec<typeof ArrowSchema>,
  spells: {
    file: 'spells.json',
    schema: SpellSchema,
    upsert: (e) => createOrUpdateSpell(e),
    list: listSpells,
  } as FileSpec<typeof SpellSchema>,
  items: {
    file: 'items.json',
    schema: ItemSchema,
    upsert: (e) => createOrUpdateItem(e),
    list: listItems,
  } as FileSpec<typeof ItemSchema>,
  loot: {
    file: 'loot.json',
    schema: LootTableSchema,
    upsert: (e) => createOrUpdateLootTable(e),
    list: listLootTables,
  } as FileSpec<typeof LootTableSchema>,
  dialogs: {
    file: 'dialogs.json',
    schema: DialogSchema,
    upsert: (e) => createOrUpdateDialog(e),
    list: listDialogs,
  } as FileSpec<typeof DialogSchema>,
  quests: {
    file: 'quests.json',
    schema: QuestSchema,
    upsert: (e) => createOrUpdateQuest(e),
    list: listQuests,
  } as FileSpec<typeof QuestSchema>,
  recipes: {
    file: 'recipes.json',
    schema: RecipeSchema,
    upsert: (e) => createOrUpdateRecipe(e),
    list: listRecipes,
  } as FileSpec<typeof RecipeSchema>,
  npcs: {
    file: 'npcs.json',
    schema: NpcSchema,
    upsert: async (entry) => {
      const { itemsToDrop, ...npc } = entry;
      if (itemsToDrop?.length && !npc.lootTableId) {
        const table = dropsToLootTable(npc.id, npc.name, itemsToDrop);
        await createOrUpdateLootTable(table);
        npc.lootTableId = table.id;
      }
      await createOrUpdateNpc(npc);
    },
    list: listNpcs,
  } as FileSpec<typeof NpcSchema>,
  shops: {
    file: 'shops.json',
    schema: ShopSchema,
    upsert: (e) => createOrUpdateShop(e),
    list: listShops,
  } as FileSpec<typeof ShopSchema>,
  maps: {
    file: 'maps.json',
    schema: MapSchema,
    upsert: (e) => createOrUpdateMap(e),
    list: listMaps,
  } as FileSpec<typeof MapSchema>,
};

const IMPORT_ORDER: (keyof typeof SPECS)[] = [
  'arrows',
  'spells',
  'items',
  'loot',
  'dialogs',
  'quests',
  'recipes',
  'npcs',
  'shops',
  'maps',
];

function readArray(dir: string, file: string): unknown[] | null {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return null;
  const parsed: unknown = JSON.parse(fs.readFileSync(full, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON array`);
  }
  return parsed as unknown[];
}

/**
 * Every file of a pack, parsed in import order, and every problem found in
 * it, with nothing written. `npm run compat` reads an earlier release's packs
 * through this, so what it accepts is exactly what the boot accepts.
 */
export function readContentPack(dir = contentDir()): {
  batches: { key: keyof typeof SPECS; entries: unknown[] }[];
  problems: string[];
} {
  const problems: string[] = [];
  const batches: { key: keyof typeof SPECS; entries: unknown[] }[] = [];
  for (const key of IMPORT_ORDER) {
    const spec = SPECS[key];
    let rows: unknown[] | null;
    try {
      rows = readArray(dir, spec.file);
    } catch (e) {
      problems.push(`${spec.file}: ${(e as Error).message}`);
      continue;
    }
    if (rows === null) continue;

    const entries: unknown[] = [];
    rows.forEach((row, i) => {
      const result = spec.schema.safeParse(row);
      if (result.success) entries.push(result.data);
      else
        for (const x of result.error.issues)
          problems.push(`${spec.file}[${i}] ${x.path.join('.')}: ${x.message}`);
    });
    batches.push({ key, entries });
  }
  return { batches, problems };
}

/**
 * Import content/*.json into MongoDB. Call after connectToDatabase, before
 * loadInitialData. Returns false, having written nothing, when any file or
 * entry is invalid.
 */
export async function importContentPack(): Promise<boolean> {
  if (!fs.existsSync(contentDir())) {
    logger.info('[content] No content/ directory - skipping import');
    return true;
  }
  // The boot imports before loadInitialData, and the CLI never reaches it: a
  // database from a newer build has to be refused before the first upsert.
  await checkDatabaseSchemaVersion();

  // Every file is read and every entry checked before the first write, since
  // a pack imported in part is a world nobody authored. A bad pack leaves the
  // database as it was, and the server still boots on it.
  const { batches, problems } = readContentPack();

  if (problems.length > 0) {
    for (const problem of problems) logger.error(`[content] ${problem}`);
    logger.error(
      '[content] Nothing imported: the pack has the problems above, and the database keeps the content it had',
    );
    return false;
  }

  for (const { key, entries } of batches) {
    const spec = SPECS[key];
    for (const entry of entries) await spec.upsert(entry as never);
    logger.info(`[content] Imported ${entries.length} from ${spec.file}`);
  }

  await syncIdCounters();
  await reportBrokenReferences();
  return true;
}

/**
 * Moves the auto-increment counters above the ids the import just wrote.
 *
 * Content files carry their own ids and never touch the counters, so without
 * this the first item created in the editor is issued an id the pack already
 * uses, and the upsert overwrites that entry instead of adding one.
 */
async function syncIdCounters(): Promise<void> {
  try {
    const [items, npcs, maps] = await Promise.all([
      listItems(),
      listNpcs(),
      listMaps(),
    ]);
    // Ids may be non-numeric (npcs are usually named), and those
    // simply do not constrain a numeric counter.
    const highest = (ids: Array<string | number>): number =>
      ids.reduce<number>((max, id) => Math.max(max, Number(id) || 0), 0);

    await raiseCounter('item', highest(items.map((i) => i.id)));
    await raiseCounter('npc', highest(npcs.map((n) => n.id)));
    await raiseCounter('map', highest(maps.map((m) => m.id)));
  } catch (e) {
    logger.error('[content] Counter sync failed', { err: e });
  }
}

/**
 * Cross-checks the imported content and reports what points at nothing.
 *
 * Reports rather than rejects: a dangling drop id should not make the NPC
 * vanish, and aborting the import would brick a server whose content has
 * one typo. The creator gets a precise list at boot, not surprises in game.
 */
async function reportBrokenReferences(): Promise<void> {
  try {
    const [items, npcs, shops, maps, lootTables, dialogs, quests, recipes] =
      await Promise.all([
        listItems(),
        listNpcs(),
        listShops(),
        listMaps(),
        listLootTables(),
        listDialogs(),
        listQuests(),
        listRecipes(),
      ]);

    const graph = {
      items: items as { id: number }[],
      npcs: npcs as Array<{ id: string; name?: string }>,
      shops: shops as Array<{ id: string; name?: string }>,
      maps: maps as Array<{ id: string; name?: string }>,
      lootTables,
      dialogs,
      quests,
      recipes,
    };
    const references = validateContentReferences(graph);
    // Only the boot has the whole world in memory, which reachability and warp
    // landings need; the editor sees one map at a time.
    const world = validateWorldGraph(graph, {
      startMapId: gameConfig.world.startMapId,
      respawnTile: gameConfig.world.respawnTile,
    });

    const errors = [...references.errors, ...world.errors];
    const warnings = [...references.warnings, ...world.warnings];

    for (const message of errors) logger.error(`[content] ${message}`);
    for (const message of warnings) logger.warn(`[content] ${message}`);
    if (errors.length === 0 && warnings.length === 0) {
      logger.info('[content] Reference check passed');
    }
  } catch (e) {
    logger.error('[content] Reference check failed', { err: e });
  }
}

/**
 * Reports content that names a behaviour no script registered. Runs after
 * scripts load, as the registry is empty before. Reports rather than
 * rejects, like the import check: a stale `scriptId` costs a log line.
 */
export async function reportUnknownBehaviors(): Promise<void> {
  try {
    const [items, npcs, maps, lootTables, dialogs, quests, recipes] =
      await Promise.all([
        listItems(),
        listNpcs(),
        listMaps(),
        listLootTables(),
        listDialogs(),
        listQuests(),
        listRecipes(),
      ]);

    const { warnings } = validateScriptReferences(
      {
        items,
        npcs,
        maps,
        // These name code through provide() rather than attach(), and are
        // checked here for the same reason: the registry only has entries once
        // scripts have run.
        lootTables,
        dialogs,
        quests,
        recipes,
      },
      registeredBehaviors(),
      isProvided,
    );

    for (const message of warnings) logger.warn(`[content] ${message}`);
  } catch (e) {
    logger.error('[content] Behavior reference check failed', { err: e });
  }
}

/** Snapshot current DB content to content/*.json so it can be versioned. */
export async function exportContentPack(): Promise<void> {
  const dir = contentDir();
  fs.mkdirSync(dir, { recursive: true });

  for (const key of IMPORT_ORDER) {
    const spec = SPECS[key];
    const rows = await spec.list();
    const cleaned = rows.map(stripMongoFields);
    const full = path.join(dir, spec.file);
    fs.writeFileSync(full, JSON.stringify(cleaned, null, 2) + '\n');
    logger.info(`[content] Exported ${cleaned.length} to ${spec.file}`);
  }
}

function stripMongoFields(doc: unknown): unknown {
  if (doc === null || typeof doc !== 'object') return doc;
  const { _id, __v, ...rest } = doc as Record<string, unknown>;
  void _id;
  void __v;
  return rest;
}
