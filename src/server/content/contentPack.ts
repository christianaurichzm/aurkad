import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { logger } from '../logger.js';
import { TileSchema } from '../http/bodySchemas.js';
import { EQUIPMENT_SLOTS } from '../../shared/constants.js';
import {
  createOrUpdateItem,
  listItems,
} from '../services/economy/inventoryService.js';
import { createOrUpdateNpc, listNpcs } from '../services/npc/persistenceOps.js';
import { createOrUpdateMap, listMaps } from '../services/world/mapService.js';
import {
  createOrUpdateShop,
  listShops,
} from '../services/economy/shopService.js';
import {
  validateContentReferences,
  validateScriptReferences,
} from '../services/content/contentValidation.js';
import { knownBehaviorIds } from '../engine/scripting/entityScripts.js';

// Versionable game content lives as JSON files in content/. On boot it is
// upserted into MongoDB (files win for the ids they define), so a creator can
// fork the repo, edit files, and commit an entire game. Mongo remains the
// runtime source of truth; export snapshots the current DB back to files.

const contentDir = (): string =>
  process.env.CONTENT_PATH
    ? path.resolve(process.env.CONTENT_PATH)
    : path.join(process.cwd(), 'content');

const ItemTypeSchema = z.enum([...EQUIPMENT_SLOTS, 'consumable', 'money']);
const EffectSchema = z.object({
  attribute: z.enum([
    'health',
    'maxHealth',
    'attack',
    'strength',
    'defense',
    'agility',
    'vitality',
    'speed',
    'attackRange',
    'experience',
    'experienceToNextLevel',
    'level',
  ]),
  type: z.enum(['add', 'multiply']),
  value: z.number(),
});
const NpcBehaviorSchema = z.enum([
  'aggressive',
  'hostile',
  'neutral',
  'friendly',
  'shopkeeper',
  'guard',
]);

const ItemSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().default(''),
  sprite: z.number().int().nonnegative(),
  type: ItemTypeSchema,
  effects: z.array(EffectSchema).optional(),
  scriptId: z.string().optional(),
});

const NpcSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sprite: z.number().int().nonnegative(),
  width: z.number().int().positive().default(48),
  height: z.number().int().positive().default(48),
  maxHealth: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  attackRange: z.number().int().positive().default(48),
  behavior: NpcBehaviorSchema,
  experienceValue: z.number().int().nonnegative().optional(),
  itemsToDrop: z
    .array(
      z.object({
        itemId: z.number().int().nonnegative(),
        chance: z.number().min(0).max(1),
        quantity: z.number().int().positive().optional(),
      }),
    )
    .optional(),
  scriptId: z.string().optional(),
});

const MapSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['pvp', 'normal']),
  pvp: z.enum(['safe', 'normal', 'no-penalty']).optional(),
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

// Order matters on import: items before npcs/shops (which reference item ids),
// maps last (they reference npc/item ids via tiles).
const SPECS = {
  items: {
    file: 'items.json',
    schema: ItemSchema,
    upsert: (e) => createOrUpdateItem(e),
    list: listItems,
  } as FileSpec<typeof ItemSchema>,
  npcs: {
    file: 'npcs.json',
    schema: NpcSchema,
    upsert: (e) => createOrUpdateNpc(e),
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

const IMPORT_ORDER: (keyof typeof SPECS)[] = ['items', 'npcs', 'shops', 'maps'];

function readArray(file: string): unknown[] | null {
  const full = path.join(contentDir(), file);
  if (!fs.existsSync(full)) return null;
  const parsed = JSON.parse(fs.readFileSync(full, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON array`);
  }
  return parsed;
}

/**
 * Imports content/*.json into MongoDB. Call it after connectToDatabase
 * and before loadInitialData.
 */
export async function importContentPack(): Promise<void> {
  if (!fs.existsSync(contentDir())) {
    logger.info('[content] No content/ directory - skipping import');
    return;
  }

  for (const key of IMPORT_ORDER) {
    const spec = SPECS[key];
    let rows: unknown[] | null;
    try {
      rows = readArray(spec.file);
    } catch (e) {
      logger.error(`[content] Failed to read ${spec.file}`, { err: e });
      continue;
    }
    if (rows === null) continue;

    let ok = 0;
    for (let i = 0; i < rows.length; i++) {
      const result = spec.schema.safeParse(rows[i]);
      if (!result.success) {
        logger.warn(`[content] Invalid entry in ${spec.file}[${i}]`, {
          issues: result.error.issues.map(
            (x) => `${x.path.join('.')}: ${x.message}`,
          ),
        });
        continue;
      }
      try {
        await spec.upsert(result.data as never);
        ok++;
      } catch (e) {
        logger.error(`[content] Upsert failed for ${spec.file}[${i}]`, {
          err: e,
        });
      }
    }
    logger.info(`[content] Imported ${ok}/${rows.length} from ${spec.file}`);
  }

  await reportBrokenReferences();
}

/**
 * Cross-checks the imported content and reports what points at nothing,
 * rather than rejecting: a dangling drop id should not make the NPC vanish
 * or one typo brick the server. The creator gets a precise list at boot.
 */
async function reportBrokenReferences(): Promise<void> {
  try {
    const [items, npcs, shops, maps] = await Promise.all([
      listItems(),
      listNpcs(),
      listShops(),
      listMaps(),
    ]);

    const { errors, warnings } = validateContentReferences({
      items: items as { id: number }[],
      npcs: npcs as Array<{ id: string; name?: string }>,
      shops: shops as Array<{ id: string; name?: string }>,
      maps: maps as Array<{ id: string; name?: string }>,
    });

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
    const [items, npcs, maps] = await Promise.all([
      listItems(),
      listNpcs(),
      listMaps(),
    ]);

    const { warnings } = validateScriptReferences(
      {
        items: items as { id: number; scriptId?: string }[],
        npcs: npcs as Array<{ id: string; name?: string; scriptId?: string }>,
        maps: maps as Array<{ id: string; name?: string }>,
      },
      knownBehaviorIds(),
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
