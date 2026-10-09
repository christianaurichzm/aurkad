/**
 * Content pack round-trip through a real (in-memory) MongoDB.
 * Verifies import validation/upsert, import ordering, and export snapshot.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { logger } from '../logger.js';
import { TILE_SIZE } from '../../shared/constants.js';
import mongoose from 'mongoose';
import fc from 'fast-check';
import type { z } from 'zod';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';
import { importContentPack, exportContentPack, SPECS } from './contentPack.js';
import ArrowModel from '../model/Arrow.js';
import SpellModel from '../model/Spell.js';
import ItemModel from '../model/Item.js';
import LootTableModel from '../model/LootTable.js';
import DialogModel from '../model/Dialog.js';
import QuestModel from '../model/Quest.js';
import RecipeModel from '../model/Recipe.js';
import NpcModel from '../model/Npc.js';
import ShopModel from '../model/Shop.js';
import MapModel from '../model/Map.js';
import {
  listItems,
  createOrUpdateItem,
} from '../services/content/itemService.js';
import { listNpcs, updateNpcAll } from '../services/content/npcService.js';
import { listMaps } from '../services/world/mapService.js';
import { listShops } from '../services/economy/shopService.js';
import {
  listLootTables,
  clearLootTableCache,
} from '../services/content/lootTableService.js';
import {
  DB_SCHEMA_VERSION,
  getNextItemId,
  getNextNpcId,
} from '../services/dbService.js';
import { listArrows } from '../services/content/arrowService.js';
import { listSpells } from '../services/content/spellService.js';

let mongod: MongoMemoryServer;
let tmpDir: string;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-'));
  process.env.CONTENT_PATH = tmpDir;
});

afterEach(() => {
  delete process.env.CONTENT_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(file: string, data: unknown) {
  fs.writeFileSync(path.join(tmpDir, file), JSON.stringify(data));
}

// z.object strips unknown keys, so a field the model persists but the pack
// schema does not declare survives export and is silently dropped on the next
// import. Every model field is either in the pack or listed here with a reason.
const MODEL_FIELDS_NOT_IN_PACK: Record<keyof typeof SPECS, string[]> = {
  arrows: [],
  spells: [],
  items: [],
  loot: [],
  dialogs: [],
  quests: [],
  recipes: [],
  npcs: [],
  shops: [],
  maps: [],
};

const PACK_MODELS: Record<keyof typeof SPECS, { schema: mongoose.Schema }> = {
  arrows: ArrowModel,
  spells: SpellModel,
  items: ItemModel,
  loot: LootTableModel,
  dialogs: DialogModel,
  quests: QuestModel,
  recipes: RecipeModel,
  npcs: NpcModel,
  shops: ShopModel,
  maps: MapModel,
};

describe('pack schemas', () => {
  it.each(Object.keys(SPECS) as (keyof typeof SPECS)[])(
    '%s declares every field its model persists',
    (key) => {
      const topLevel = new Set(
        Object.keys(PACK_MODELS[key].schema.paths).map((p) => p.split('.')[0]),
      );
      const packKeys = Object.keys(SPECS[key].schema.shape);
      const missing = [...topLevel].filter(
        (p) =>
          p !== '_id' &&
          p !== '__v' &&
          !packKeys.includes(p!) &&
          !MODEL_FIELDS_NOT_IN_PACK[key].includes(p!),
      );
      expect(missing).toEqual([]);
    },
  );
});

describe('importContentPack', () => {
  it('imports valid items, npcs, shops and maps into the DB', async () => {
    write('items.json', [
      {
        id: 1,
        name: 'Potion',
        sprite: 0,
        type: 'consumable',
        effects: [{ attribute: 'health', type: 'add', value: 20 }],
      },
      { id: 2, name: 'Sword', sprite: 1, type: 'weapon' },
    ]);
    write('npcs.json', [
      {
        id: 'goblin',
        name: 'Goblin',
        sprite: 2,
        maxHealth: 30,
        attack: 5,
        behavior: 'aggressive',
      },
    ]);
    write('shops.json', [
      {
        id: 'general',
        name: 'General Store',
        products: [{ itemId: 1, currency: 2, price: 10 }],
      },
    ]);
    write('maps.json', [
      {
        id: 'overworld',
        name: 'Overworld',
        type: 'normal',
        tiles: [[{ tileIndex: 0 }]],
      },
    ]);

    await importContentPack();

    const items = await listItems();
    const npcs = await listNpcs();
    const shops = await listShops();
    const maps = await listMaps();

    expect(items.map((i) => i.id).sort()).toEqual([1, 2]);
    expect(npcs.map((n) => n.id)).toEqual(['goblin']);
    expect(shops.map((s) => s.id)).toEqual(['general']);
    expect(maps.map((m) => m.id)).toEqual(['overworld']);
  });

  it('refuses an item 0, which the database would have renumbered', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    write('items.json', [
      { id: 0, name: 'Potion', sprite: 0, type: 'consumable' },
    ]);

    expect(await importContentPack()).toBe(false);
    expect(await listItems()).toEqual([]);
  });

  // A pack written by hand (as the demos are) names behaviour, not geometry.
  // Less than a tile misplaces the health bar and leaves a melee npc unable
  // to reach the next tile.
  it('gives an npc with no geometry a full tile of it', async () => {
    write('npcs.json', [
      {
        id: 'lia',
        name: 'Lia',
        sprite: 4,
        maxHealth: 200,
        attack: 0,
        behavior: 'friendly',
      },
    ]);

    await importContentPack();

    const [npc] = await listNpcs();
    expect(npc?.width).toBe(TILE_SIZE);
    expect(npc?.height).toBe(TILE_SIZE);
    expect(npc?.attackRange).toBe(TILE_SIZE);
  });

  it('persists tile triggers through the map import', async () => {
    write('maps.json', [
      {
        id: 'trap-map',
        name: 'Trap',
        type: 'normal',
        tiles: [[{ tileIndex: 0, triggers: [{ action: 'kill' }] }]],
      },
    ]);

    await importContentPack();

    const maps = await listMaps();
    expect(maps[0]!.tiles[0]![0]!.triggers).toEqual([{ action: 'kill' }]);
  });

  // These hold a world of several maps together, and the schema that parses
  // the file decides what survives, so adjacent maps must not arrive as
  // islands while the import reports every map written.
  it('keeps a dungeon a dungeon through the map import', async () => {
    write('maps.json', [
      {
        id: 'crypt',
        name: 'Crypt',
        type: 'normal',
        instanced: true,
        tiles: [[{ tileIndex: 0 }]],
      },
    ]);
    await importContentPack();

    const [crypt] = await listMaps();
    expect(crypt).toMatchObject({ id: 'crypt', instanced: true });
  });

  it('persists border links through the map import', async () => {
    write('maps.json', [
      {
        id: 'town',
        name: 'Town',
        type: 'normal',
        borderLinks: { up: { to: 'fields', position: { x: 64, y: 128 } } },
        music: 'town-theme',
        tiles: [[{ tileIndex: 0 }]],
      },
    ]);

    await importContentPack();

    const [map] = await listMaps();
    expect(map!.borderLinks).toEqual({
      up: { to: 'fields', position: { x: 64, y: 128 } },
    });
    expect(map!.music).toBe('town-theme');
  });

  it('writes nothing from a pack with an invalid entry anywhere in it', async () => {
    write('items.json', [
      { id: 1, name: 'Potion', sprite: 0, type: 'consumable' },
    ]);
    await importContentPack();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    write('items.json', [
      { id: 1, name: 'Potion v2', sprite: 0, type: 'consumable' },
      { id: 2, name: 'Elixir', sprite: 0, type: 'consumable' },
    ]);
    write('shops.json', [{ id: 'general', name: 'General', products: 'none' }]);
    fs.writeFileSync(path.join(tmpDir, 'maps.json'), '[{');

    await expect(importContentPack()).resolves.toBe(false);

    expect(await listItems()).toEqual([
      expect.objectContaining({ id: 1, name: 'Potion' }),
    ]);
    const logged = error.mock.calls.map(([message]) => message).join('\n');
    expect(logged).toContain('shops.json[0] products');
    expect(logged).toContain('maps.json');
    error.mockRestore();
  });

  it('is idempotent - re-importing upserts by id, no duplicates', async () => {
    write('items.json', [
      { id: 1, name: 'Potion', sprite: 0, type: 'consumable' },
    ]);
    await importContentPack();
    write('items.json', [
      { id: 1, name: 'Potion v2', sprite: 0, type: 'consumable' },
    ]);
    await importContentPack();

    const items = await listItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe('Potion v2');
  });

  // A pack is a whole game: a bow that lost its arrow on import is a weapon
  // that cannot shoot, and nothing said so.
  it('keeps what makes an item a ranged weapon or a bound one', async () => {
    write('arrows.json', [
      { id: 1, name: 'Wooden Arrow', sprite: 4, damage: 9, rangeTiles: 6 },
    ]);
    write('items.json', [
      { id: 9, name: 'Hunting Bow', sprite: 1, type: 'weapon', arrowId: 1 },
      { id: 10, name: 'Relic', sprite: 2, type: 'consumable', bound: true },
    ]);
    await importContentPack();

    const items = await listItems();
    expect(items.find((i) => i.id === 9)).toMatchObject({ arrowId: 1 });
    expect(items.find((i) => i.id === 10)).toMatchObject({ bound: true });
    expect(await listArrows()).toEqual([
      expect.objectContaining({ id: 1, name: 'Wooden Arrow', damage: 9 }),
    ]);
  });

  it('imports the spells a pack defines', async () => {
    write('spells.json', [
      { id: 3, name: 'Mending Light', sprite: 57, target: 'party', heal: 40 },
    ]);
    await importContentPack();

    expect(await listSpells()).toEqual([
      expect.objectContaining({
        id: 3,
        name: 'Mending Light',
        target: 'party',
        heal: 40,
        mpCost: 0,
      }),
    ]);
  });

  it('refuses a database from a newer build before writing to it', async () => {
    await mongoose
      .model('Meta')
      .create({ _id: 'schemaVersion', value: DB_SCHEMA_VERSION + 1 });
    write('items.json', [
      { id: 1, name: 'Potion', sprite: 0, type: 'consumable' },
    ]);

    await expect(importContentPack()).rejects.toThrow(/schema version/);
    expect(await listItems()).toHaveLength(0);
  });

  it('does nothing when content dir is missing', async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await expect(importContentPack()).resolves.toBe(true);
    expect(await listItems()).toHaveLength(0);
  });
});

describe('exportContentPack', () => {
  it('writes current DB content to JSON files without mongo internals', async () => {
    write('items.json', [{ id: 7, name: 'Gold', sprite: 0, type: 'money' }]);
    await importContentPack();

    // Export into a fresh dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-out-'));
    process.env.CONTENT_PATH = tmpDir;

    await exportContentPack();

    const raw = fs.readFileSync(path.join(tmpDir, 'items.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 7, name: 'Gold', type: 'money' });
    expect(parsed[0]._id).toBeUndefined();
    expect(parsed[0].__v).toBeUndefined();
  });

  it('export then import round-trips', async () => {
    write('npcs.json', [
      {
        id: 'orc',
        name: 'Orc',
        sprite: 3,
        maxHealth: 50,
        attack: 8,
        behavior: 'hostile',
        sight: 6,
        pathDepth: 10,
        leash: 3,
        moveIntervalMs: 800,
        respawnMs: 30000,
      },
    ]);
    await importContentPack();
    await exportContentPack();

    // Wipe DB, re-import from exported files
    await mongoose.connection.collections['npcs']?.deleteMany({});
    expect(await listNpcs()).toHaveLength(0);

    await importContentPack();
    const npcs = await listNpcs();
    expect(npcs).toHaveLength(1);
    expect(npcs[0]).toMatchObject({
      id: 'orc',
      name: 'Orc',
      behavior: 'hostile',
      sight: 6,
      pathDepth: 10,
      leash: 3,
      moveIntervalMs: 800,
      respawnMs: 30000,
    });
  });
});

describe('exporting arrows and spells', () => {
  it('writes them next to the items that use them', async () => {
    write('arrows.json', [{ id: 1, name: 'Wooden Arrow', sprite: 4 }]);
    write('spells.json', [{ id: 1, name: 'Arcane Blast', sprite: 0 }]);
    await importContentPack();

    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-out-'));
    process.env.CONTENT_PATH = tmpDir;
    await exportContentPack();

    const read = (file: string) =>
      JSON.parse(fs.readFileSync(path.join(tmpDir, file), 'utf-8'));
    expect(read('arrows.json')).toEqual([
      expect.objectContaining({ id: 1, name: 'Wooden Arrow' }),
    ]);
    expect(read('spells.json')).toEqual([
      expect.objectContaining({ id: 1, name: 'Arcane Blast' }),
    ]);
  });
});

describe('reference check on import', () => {
  it('warns about an npc drop that points at no item, and still imports the npc', async () => {
    const warnings: string[] = [];
    const spy = vi
      .spyOn(logger, 'warn')
      .mockImplementation((msg: string) => void warnings.push(msg));

    write('items.json', [
      { id: 1, name: 'Potion', sprite: 0, type: 'consumable' },
    ]);
    write('npcs.json', [
      {
        id: 'goblin',
        name: 'Goblin',
        sprite: 2,
        maxHealth: 30,
        attack: 5,
        behavior: 'aggressive',
        itemsToDrop: [{ itemId: 999, chance: 0.5 }],
      },
    ]);

    await importContentPack();

    // The typo is reported, but the NPC is not sacrificed for it.
    expect(warnings.some((w) => w.includes('999'))).toBe(true);
    expect(await listNpcs()).toHaveLength(1);

    spy.mockRestore();
  });

  it('warns about a shop selling an item that does not exist', async () => {
    const warnings: string[] = [];
    const spy = vi
      .spyOn(logger, 'warn')
      .mockImplementation((msg: string) => void warnings.push(msg));

    write('items.json', [
      { id: 1, name: 'Potion', sprite: 0, type: 'consumable' },
    ]);
    write('shops.json', [
      {
        id: 'general',
        name: 'General Store',
        products: [{ itemId: 404, currency: 1, price: 10 }],
      },
    ]);

    await importContentPack();

    expect(warnings.some((w) => w.includes('404'))).toBe(true);
    expect(await listShops()).toHaveLength(1);

    spy.mockRestore();
  });

  it('stays quiet when every reference resolves', async () => {
    const warnings: string[] = [];
    const spy = vi
      .spyOn(logger, 'warn')
      .mockImplementation((msg: string) => void warnings.push(msg));

    write('items.json', [
      { id: 1, name: 'Potion', sprite: 0, type: 'consumable' },
    ]);
    write('npcs.json', [
      {
        id: 'goblin',
        name: 'Goblin',
        sprite: 2,
        maxHealth: 30,
        attack: 5,
        behavior: 'aggressive',
        itemsToDrop: [{ itemId: 1, chance: 0.5 }],
      },
    ]);

    await importContentPack();

    expect(warnings).toEqual([]);

    spy.mockRestore();
  });
});

describe('loot tables', () => {
  beforeEach(() => {
    clearLootTableCache();
  });

  it('imports a table and the npc that uses it', async () => {
    write('items.json', [
      { id: 1, name: 'Coin', sprite: 0, type: 'money' },
      { id: 2, name: 'Sword', sprite: 1, type: 'weapon' },
    ]);
    write('loot.json', [
      {
        id: 'goblin-tier1',
        name: 'Goblin tier 1',
        guaranteed: [{ itemId: 1, quantity: { min: 3, max: 9 } }],
        rolls: { min: 1, max: 2 },
        entries: [{ itemId: 2, weight: 5 }],
        emptyWeight: 20,
      },
    ]);
    write('npcs.json', [
      {
        id: 'goblin',
        name: 'Goblin',
        sprite: 2,
        maxHealth: 30,
        attack: 5,
        behavior: 'aggressive',
        lootTableId: 'goblin-tier1',
      },
    ]);

    await importContentPack();

    const tables = await listLootTables();
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      id: 'goblin-tier1',
      rolls: { min: 1, max: 2 },
      emptyWeight: 20,
    });
    expect(tables[0]!.guaranteed![0]!.quantity).toEqual({ min: 3, max: 9 });

    const npcs = await listNpcs();
    expect(npcs[0]).toMatchObject({ lootTableId: 'goblin-tier1' });
  });

  it('keeps a fixed quantity a plain number through the round trip', async () => {
    write('items.json', [{ id: 1, name: 'Coin', sprite: 0, type: 'money' }]);
    write('loot.json', [
      {
        id: 't',
        name: 'T',
        guaranteed: [{ itemId: 1, quantity: 5 }],
      },
    ]);

    await importContentPack();
    await exportContentPack();

    const raw = fs.readFileSync(path.join(tmpDir, 'loot.json'), 'utf-8');
    expect(JSON.parse(raw)[0].guaranteed[0].quantity).toBe(5);
  });

  it('warns about a table dropping an item that does not exist', async () => {
    const warnings: string[] = [];
    const spy = vi
      .spyOn(logger, 'warn')
      .mockImplementation((msg: string) => void warnings.push(msg));

    write('items.json', [{ id: 1, name: 'Coin', sprite: 0, type: 'money' }]);
    write('loot.json', [
      { id: 't', name: 'T', entries: [{ itemId: 4040, weight: 1 }] },
    ]);

    await importContentPack();

    expect(warnings.some((w) => w.includes('4040'))).toBe(true);
    // Reported, not rejected, like the other content checks.
    expect(await listLootTables()).toHaveLength(1);

    spy.mockRestore();
  });

  it('warns about an npc pointing at a table that was never defined', async () => {
    const warnings: string[] = [];
    const spy = vi
      .spyOn(logger, 'warn')
      .mockImplementation((msg: string) => void warnings.push(msg));

    write('items.json', [{ id: 1, name: 'Coin', sprite: 0, type: 'money' }]);
    write('npcs.json', [
      {
        id: 'goblin',
        name: 'Goblin',
        sprite: 2,
        maxHealth: 30,
        attack: 5,
        behavior: 'aggressive',
        lootTableId: 'never-defined',
      },
    ]);

    await importContentPack();

    expect(warnings.some((w) => w.includes('never-defined'))).toBe(true);
    expect(await listNpcs()).toHaveLength(1);

    spy.mockRestore();
  });
});

describe('clearing an optional reference', () => {
  // The editor submits the whole form, so a missing field was cleared. A
  // plain $set only writes keys that are present, so the import also needs
  // the $unset or the value comes back on the next load.
  async function importGoblin(extra: Record<string, unknown>) {
    write('npcs.json', [
      {
        id: 'goblin',
        name: 'Goblin',
        sprite: 2,
        maxHealth: 30,
        attack: 5,
        behavior: 'aggressive',
        ...extra,
      },
    ]);
    await importContentPack();
  }

  it('removes an npc loot table when the editor saves without one', async () => {
    await importGoblin({ lootTableId: 'goblin-tier1' });
    expect((await listNpcs())[0]).toMatchObject({
      lootTableId: 'goblin-tier1',
    });

    await updateNpcAll('goblin', {
      name: 'Goblin',
      sprite: 2,
      maxHealth: 30,
      attack: 5,
      behavior: 'aggressive',
    });

    expect((await listNpcs())[0]!.lootTableId).toBeUndefined();
  });

  it('removes an npc script behavior the same way', async () => {
    await importGoblin({ scriptId: 'quest-giver' });

    await updateNpcAll('goblin', {
      name: 'Goblin',
      sprite: 2,
      maxHealth: 30,
      attack: 5,
      behavior: 'aggressive',
    });

    expect((await listNpcs())[0]!.scriptId).toBeUndefined();
  });

  it('keeps the reference when it is still there', async () => {
    await importGoblin({ lootTableId: 'keep-me' });

    await updateNpcAll('goblin', {
      name: 'Goblin',
      sprite: 2,
      maxHealth: 30,
      attack: 5,
      behavior: 'aggressive',
      lootTableId: 'keep-me',
    });

    expect((await listNpcs())[0]).toMatchObject({ lootTableId: 'keep-me' });
  });

  it('removes an item script behavior when saved without one', async () => {
    write('items.json', [
      {
        id: 1,
        name: 'Scroll',
        sprite: 0,
        type: 'consumable',
        scriptId: 'teleport',
      },
    ]);
    await importContentPack();
    expect((await listItems())[0]).toMatchObject({ scriptId: 'teleport' });

    await createOrUpdateItem({
      id: 1,
      name: 'Scroll',
      description: '',
      sprite: 0,
      type: 'consumable',
    });

    expect((await listItems())[0]!.scriptId).toBeUndefined();
  });
});

// Documents arrive through the counter (editor "create") and through
// content files with their own ids. A pack with items 1..8 must move the
// counter too, or the editor's next item gets id 1 and overwrites the pack's.
describe('id counters after import', () => {
  it('raises the counter above the ids the pack defines', async () => {
    write('items.json', [
      { id: 1, name: 'Potion', sprite: 0, type: 'consumable' },
      { id: 8, name: 'Steel Sword', sprite: 1, type: 'weapon' },
    ]);

    await importContentPack();

    const created = await getNextItemId();
    expect(created).toBe(9);

    // The proof that matters: creating one does not overwrite an existing item.
    await createOrUpdateItem({
      id: created,
      name: 'New',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    const ids = (await listItems()).map((i) => i.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 8, 9]);
  });

  it('leaves the counter alone when the ids are not numeric', async () => {
    // Npcs are usually named ('goblin'), which constrains nothing.
    write('npcs.json', [
      {
        id: 'goblin',
        name: 'Goblin',
        sprite: 2,
        maxHealth: 30,
        attack: 5,
        behavior: 'aggressive',
      },
    ]);

    await importContentPack();

    expect(await getNextNpcId()).toBe(1);
  });

  it('never lowers a counter that is already ahead', async () => {
    // Lowering one would re-issue an id that is already in use; a counter ahead
    // of the documents only leaves a gap.
    await getNextItemId();
    await getNextItemId();
    await getNextItemId();
    write('items.json', [
      { id: 1, name: 'Potion', sprite: 0, type: 'consumable' },
    ]);

    await importContentPack();

    expect(await getNextItemId()).toBe(4);
  });
});

// Any pack the schemas accept has to come back from the database as the
// schemas read it. This generates the combinations nobody wrote down: an
// optional field present in one entry and absent in the next, an empty
// list, a null.
describe('a generated pack', () => {
  type Def = {
    type: string;
    shape?: Record<string, z.ZodType>;
    innerType?: z.ZodType;
    element?: z.ZodType;
    options?: z.ZodType[];
    entries?: Record<string, string>;
    values?: unknown[];
    keyType?: z.ZodType;
    valueType?: z.ZodType;
  };
  type Bag = {
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    format?: string;
    patterns?: Set<RegExp>;
  };
  const inside = (schema: z.ZodType) =>
    (schema as unknown as { _zod: { def: Def; bag: Bag } })._zod;

  /** Values for a schema, kept small so a failure stays readable. */
  function arbitraryOf(schema: z.ZodType): fc.Arbitrary<unknown> {
    const { def, bag } = inside(schema);
    switch (def.type) {
      case 'object': {
        const shape = def.shape!;
        const required = Object.keys(shape).filter((key) => {
          const t = inside(shape[key]!).def.type;
          return t !== 'optional' && t !== 'default';
        });
        return fc.record(
          Object.fromEntries(
            Object.entries(shape).map(([key, field]) => [
              key,
              arbitraryOf(field),
            ]),
          ),
          { requiredKeys: required as never[] },
        );
      }
      case 'optional':
      case 'default':
        return arbitraryOf(def.innerType!);
      case 'nullable':
        return fc.option(arbitraryOf(def.innerType!), { nil: null });
      case 'string': {
        const min = bag.minimum ?? 0;
        const patterns = [...(bag.patterns ?? [])];
        return fc
          .string({
            unit: fc.constantFrom('a', 'b', 'c', '#', '1', ' '),
            minLength: min,
            maxLength: Math.min(bag.maximum ?? min + 5, min + 5),
          })
          .filter((v) => patterns.every((p) => p.test(v)));
      }
      case 'number': {
        const int = bag.format?.includes('int');
        const step = int ? 1 : 0.25;
        const min = Math.max(
          bag.minimum ?? -3,
          bag.exclusiveMinimum !== undefined ? bag.exclusiveMinimum + step : -3,
        );
        const max = Math.min(
          bag.maximum ?? Infinity,
          bag.exclusiveMaximum !== undefined
            ? bag.exclusiveMaximum - step
            : Infinity,
          min + 40,
        );
        return int
          ? fc.integer({ min: Math.ceil(min), max: Math.floor(max) })
          : fc
              .integer({
                min: Math.ceil(min / step),
                max: Math.floor(max / step),
              })
              .map((n) => n * step);
      }
      case 'boolean':
        return fc.boolean();
      case 'enum':
        return fc.constantFrom(...Object.values(def.entries!));
      case 'literal':
        return fc.constantFrom(...def.values!);
      case 'array':
        return fc.array(arbitraryOf(def.element!), {
          minLength: bag.minimum ?? 0,
          maxLength: Math.max(bag.minimum ?? 0, 2),
        });
      case 'union':
        return fc.oneof(...def.options!.map(arbitraryOf));
      case 'record':
        return fc.dictionary(
          arbitraryOf(def.keyType!) as fc.Arbitrary<string>,
          arbitraryOf(def.valueType!),
          { maxKeys: 2 },
        );
      default:
        throw new Error(`no generator for a ${def.type} schema`);
    }
  }

  const KEYS = Object.keys(SPECS) as (keyof typeof SPECS)[];

  /** Entries for one file: valid, with distinct ids. */
  function entriesFor(key: keyof typeof SPECS) {
    // Still read, never written: an old pack's drops become a loot table of
    // the npc's own, so they cannot come back as they went in.
    const schema =
      key === 'npcs'
        ? SPECS.npcs.schema.omit({ itemsToDrop: true })
        : SPECS[key].schema;
    return fc.uniqueArray(
      arbitraryOf(schema).filter((v) => schema.safeParse(v).success),
      { selector: (v) => (v as { id: unknown }).id, maxLength: 2 },
    );
  }

  const pack = fc.record(
    Object.fromEntries(KEYS.map((key) => [key, entriesFor(key)])) as Record<
      keyof typeof SPECS,
      fc.Arbitrary<unknown[]>
    >,
  );

  const byId = (rows: unknown[]) =>
    [...rows].sort((a, b) =>
      String((a as { id: unknown }).id).localeCompare(
        String((b as { id: unknown }).id),
      ),
    );
  /**
   * Mongoose starts every array field as an empty one and drops empty objects
   * on write, so a list the file left out comes back as [] and a {} the file
   * wrote comes back absent. Both pairs mean the same to everything that reads
   * them. A field that lost what it held still shows, since only the input
   * side can be empty.
   */
  const withoutEmpties = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutEmpties);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, withoutEmpties(v)] as const)
        .filter(
          ([, v]) =>
            !(Array.isArray(v) && v.length === 0) &&
            !(
              v &&
              typeof v === 'object' &&
              !Array.isArray(v) &&
              Object.keys(v).length === 0
            ),
        ),
    );
  };

  const read = (file: string): unknown[] =>
    JSON.parse(fs.readFileSync(path.join(tmpDir, file), 'utf-8')) as unknown[];

  it('comes back from the database as the schemas read it', async () => {
    await fc.assert(
      fc.asyncProperty(pack, async (files) => {
        const cols = mongoose.connection.collections;
        await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
        for (const key of KEYS) write(SPECS[key].file, files[key]);

        expect(await importContentPack()).toBe(true);
        await exportContentPack();

        for (const key of KEYS) {
          const schema = SPECS[key].schema as z.ZodType;
          const expected = JSON.parse(
            JSON.stringify(files[key].map((row) => schema.parse(row))),
          ) as unknown[];
          expect({
            [key]: withoutEmpties(byId(read(SPECS[key].file))),
          }).toEqual({ [key]: withoutEmpties(byId(expected)) });
        }
      }),
      { numRuns: 40 },
    );
  });
});
