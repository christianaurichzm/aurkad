/**
 * Content pack round-trip through a real (in-memory) MongoDB.
 * Verifies import validation/upsert, import ordering, and export snapshot.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
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
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { importContentPack, exportContentPack } from './contentPack.js';
import {
  listItems,
  createOrUpdateItem,
} from '../services/economy/inventoryService.js';
import { listNpcs, updateNpcAll } from '../services/npc/persistenceOps.js';
import { listMaps } from '../services/world/mapService.js';
import { listShops } from '../services/economy/shopService.js';
import {
  listLootTables,
  clearLootTableCache,
} from '../services/economy/lootTableService.js';

let mongod: MongoMemoryServer;
let tmpDir: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
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

  it('skips invalid entries but imports the valid ones', async () => {
    write('items.json', [
      { id: 1, name: 'Valid', sprite: 0, type: 'consumable' },
      { id: 2, name: 'BadType', sprite: 0, type: 'not-a-real-type' },
      { name: 'NoId', sprite: 0, type: 'money' },
    ]);

    await importContentPack();

    const items = await listItems();
    expect(items.map((i) => i.id)).toEqual([1]);
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

  it('does nothing when content dir is missing', async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await expect(importContentPack()).resolves.toBeUndefined();
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
    });
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
