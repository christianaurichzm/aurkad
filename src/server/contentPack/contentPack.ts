import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { gamePath } from '../config.js';
import { logger } from '../logger.js';
import {
  BorderLinksSchema,
  CreateArrowBodySchema,
  CreateItemBodySchema,
  NpcTuningFields,
  ScriptParamsSchema,
  TileSchema,
} from '../http/bodySchemas.js';
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

const NpcBehaviorSchema = z.enum([
  'aggressive',
  'hostile',
  'neutral',
  'friendly',
  'shopkeeper',
  'guard',
]);

// The editor's own schema plus the id the file carries: z.object drops what it
// does not know, so a field declared in one place only is lost on every import.
const ItemSchema = CreateItemBodySchema.extend({
  // Not 0: an item saved without an id is given the next one, and 0 reads as
  // none, so an item 0 in a file would come in renumbered and every loot
  // table, shop and tile naming it would point at nothing.
  id: z.number().int().positive(),
});
const ArrowSchema = CreateArrowBodySchema.extend({
  id: z.number().int().positive(),
});
const SpellSchema = SpellFieldsSchema.extend({
  id: z.number().int().positive(),
});

const NpcSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sprite: z.number().int().nonnegative(),
  // One tile, like every other way an npc enters the world (seed,
  // spawnNpc); smaller, the health bar is narrower than the sprite and a
  // melee npc cannot reach the next tile.
  width: z.number().int().positive().default(SPRITE_WIDTH),
  height: z.number().int().positive().default(SPRITE_HEIGHT),
  maxHealth: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  attackRange: z.number().int().positive().default(TILE_SIZE),
  behavior: NpcBehaviorSchema,
  experienceValue: z.number().int().nonnegative().optional(),
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
  lootTableId: z.string().optional(),
  dialogId: z.string().optional(),
  questId: z.string().optional(),
  scriptId: z.string().optional(),
  scriptParams: ScriptParamsSchema.optional(),
  ...NpcTuningFields,
});

const LootQuantitySchema = z.union([
  z.number().int().positive(),
  z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
]);

const LootEntrySchema = z.object({
  itemId: z.number().int().nonnegative(),
  weight: z.number().nonnegative().optional(),
  chance: z.number().min(0).max(1).optional(),
  quantity: LootQuantitySchema.optional(),
  condition: z.string().min(1).optional(),
});

const LootTableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  guaranteed: z.array(LootEntrySchema).optional(),
  rolls: z
    .object({
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    })
    .optional(),
  entries: z.array(LootEntrySchema).optional(),
  emptyWeight: z.number().nonnegative().optional(),
});

const DialogSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  start: z.string().min(1).optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        choices: z
          .array(
            z.object({
              label: z.string().min(1),
              next: z.string().min(1).optional(),
              condition: z.string().min(1).optional(),
              action: z.string().min(1).optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
});

const QuestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  objective: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('kill'),
      npcId: z.string().min(1),
      count: z.number().int().positive(),
    }),
    z.object({
      type: z.literal('collect'),
      itemId: z.number().int().nonnegative(),
      count: z.number().int().positive(),
    }),
    z.object({ type: z.literal('talk'), npcId: z.string().min(1) }),
    z.object({
      type: z.literal('reach'),
      mapId: z.string().min(1),
      row: z.number().int().nonnegative(),
      col: z.number().int().nonnegative(),
    }),
  ]),
  reward: z
    .object({
      experience: z.number().int().nonnegative().optional(),
      items: z
        .array(
          z.object({
            itemId: z.number().int().nonnegative(),
            quantity: z.number().int().positive(),
          }),
        )
        .optional(),
      script: z.string().min(1).optional(),
    })
    .optional(),
});

const RecipeIngredientSchema = z.object({
  itemId: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
});

const RecipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  inputs: z.array(RecipeIngredientSchema).min(1),
  output: RecipeIngredientSchema,
  condition: z.string().min(1).optional(),
});

const MapSchema = z.object({
  // createOrUpdateMap refuses a dungeon copy's id, and the import would only
  // find out after writing everything before the maps.
  id: z
    .string()
    .min(1)
    .regex(/^[^#]+$/, 'a # marks a dungeon copy, which is never saved'),
  name: z.string().min(1),
  type: z.enum(['pvp', 'normal']),
  orientation: z.enum(['orthogonal', 'isometric']).optional(),
  pvp: z.enum(['safe', 'normal', 'no-penalty']).optional(),
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

const ShopSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  products: z.array(
    z.object({
      itemId: z.number().int().nonnegative(),
      currency: z.number().int().nonnegative(),
      price: z.number().int().nonnegative(),
    }),
  ),
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

function readArray(file: string): unknown[] | null {
  const full = path.join(contentDir(), file);
  if (!fs.existsSync(full)) return null;
  const parsed: unknown = JSON.parse(fs.readFileSync(full, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON array`);
  }
  return parsed as unknown[];
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
  const problems: string[] = [];
  const batches: { key: keyof typeof SPECS; entries: unknown[] }[] = [];
  for (const key of IMPORT_ORDER) {
    const spec = SPECS[key];
    let rows: unknown[] | null;
    try {
      rows = readArray(spec.file);
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
 * Cross-checks the imported content and reports what points at nothing,
 * rather than rejecting: a dangling drop id should not make the NPC vanish
 * or one typo brick the server. The creator gets a precise list at boot.
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
