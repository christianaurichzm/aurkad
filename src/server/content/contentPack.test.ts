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
} from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { importContentPack, exportContentPack } from './contentPack.js';
import { listItems } from '../services/inventoryService.js';
import { listNpcs } from '../services/npc/persistenceOps.js';
import { listMaps } from '../services/mapService.js';
import { listShops } from '../services/shopService.js';

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
