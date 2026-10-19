/**
 * What regenerates the script constants, and what must not.
 *
 * The routers are mounted here the way `server.ts` mounts them, because the
 * question this answers is a wiring question: the content-definition paths are
 * spread over three route files, and a middleware that only covered one of them
 * would look correct and quietly stop regenerating `Maps` after a map save.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';

const scheduleContentRefresh = vi.fn();
vi.mock('../../engine/scripting/contentConstants.js', () => ({
  scheduleContentRefresh: () => scheduleContentRefresh(),
}));
// The trail has its own tests; here it would only ask for a database.
vi.mock('../../services/auditService.js', () => ({
  recordAdminAction: vi.fn(),
  summarizeDetails: () => undefined,
}));

vi.mock('../../services/world/mapValidation.js', () => ({
  validateMapTiles: () => Promise.resolve({ errors: [], warnings: [] }),
  resizeTiles: (tiles: unknown) => tiles,
}));
vi.mock('../../services/world/mapService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  mapSave: () => Promise.resolve(),
  createOrUpdateMap: () => Promise.resolve('map1'),
  getMapById: () => Promise.resolve(null),
  listMaps: () => Promise.resolve([]),
}));
vi.mock('../../services/content/itemService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createOrUpdateItem: () => Promise.resolve(),
  deleteItem: () => Promise.reject(new Error('gone')),
  getItemById: () => undefined,
  listItems: () => Promise.resolve([]),
}));
// The two gameplay writes: they reply without a database, so the assertion is
// about the middleware and not about how far the handler got.
vi.mock('../../services/economy/shopService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getShopById: () => Promise.resolve(null),
  listShops: () => Promise.resolve([]),
  createOrUpdateShop: () => Promise.resolve(),
  deleteShop: () => Promise.resolve(),
  buyShopItem: () => Promise.resolve({ ok: false, reason: 'not-sold' }),
}));
vi.mock('../../services/player/playerService.js', () => ({
  getPlayerById: () => Promise.resolve(null),
  getPlayerByName: () => undefined,
}));

import { contentRefresh } from './contentRefresh.js';
import { createContentRouter } from '../routes/contentRoutes.js';
import { createMapRouter } from '../routes/mapRoutes.js';
import { createPlayerRouter } from '../routes/playerRoutes.js';
import { createShopRouter } from '../routes/shopRoutes.js';

const app = express();
app.use(express.json());
app.use((req: ExtendedRequest, _res, next) => {
  req.session = {
    username: 'op',
    accessLevel: Access.ADMIN,
  } as ExtendedRequest['session'];
  next();
});
app.use(contentRefresh);
app.use(createContentRouter());
app.use(createMapRouter());
app.use(createPlayerRouter());
app.use(createShopRouter());

const item = { name: 'Sword', type: 'weapon', sprite: 1, description: '' };

beforeEach(() => {
  scheduleContentRefresh.mockClear();
});

describe('regenerating the script constants after a content edit', () => {
  it('follows a content path onto whichever router serves it', async () => {
    await request(app)
      .post('/saveMap')
      .send({ mapId: 'map1', tiles: [], name: 'Town', type: 'normal' })
      .expect(200);

    expect(scheduleContentRefresh).toHaveBeenCalledOnce();
  });

  it('regenerates on a catalog write too', async () => {
    await request(app).post('/items').send(item).expect(201);

    expect(scheduleContentRefresh).toHaveBeenCalledOnce();
  });

  it('stays quiet on a read', async () => {
    await request(app).get('/items').expect(200);

    expect(scheduleContentRefresh).not.toHaveBeenCalled();
  });

  it('stays quiet when the write failed', async () => {
    await request(app).delete('/items/1').expect(500);

    expect(scheduleContentRefresh).not.toHaveBeenCalled();
  });

  it('stays quiet on a gameplay write', async () => {
    // Buying and spending points change a player, never a definition: a busy
    // shop would otherwise rebuild the constants all evening.
    await request(app).post('/shop/buy').send({ shopId: 'x', itemId: 1 });
    await request(app)
      .post('/players/abc/assignPoints')
      .send({ vitality: 1, attack: 0, strength: 0, defense: 0, agility: 0 });

    expect(scheduleContentRefresh).not.toHaveBeenCalled();
  });
});
