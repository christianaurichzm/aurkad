import { beforeAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFixture, tile } from '../../sim/simFixture.js';
import { Access, type Shop } from '../../../shared/types.js';

// The shelf is read from the database while the world keeps ticking, which is
// the window these tests reach into: `during` runs inside that read.
const read = vi.hoisted(() => ({
  shop: null as Shop | null,
  during: () => {},
}));
vi.mock('../../model/Shop.js', () => ({
  default: {
    findOne: () => ({
      lean: () => ({
        exec: async () => {
          await Promise.resolve();
          read.during();
          return read.shop;
        },
      }),
    }),
  },
}));

const { createShopRouter } = await import('./shopRoutes.js');

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = {
      username: req.get('x-user'),
      accessLevel: Access.USER,
    };
    next();
  });
  app.use(createShopRouter());
});

const GOLD = 3;
const SWORD = 9;

describe('POST /shop/buy', () => {
  it('sells nothing to a player who walked off the shop while it was read', async () => {
    const sim = createFixture(0);
    sim.map.tiles[5]![5]!.shop = 'armoury';
    const alice = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      inventory: { items: [{ item: GOLD, quantity: 10 }], maxCapacity: 10 },
    });
    read.shop = {
      id: 'armoury',
      name: 'Armoury',
      products: [{ itemId: SWORD, currency: GOLD, price: 10 }],
    };
    read.during = () => {
      alice.position = tile(9, 9);
    };

    const res = await request(app)
      .post('/shop/buy')
      .set('x-user', 'Alice')
      .send({ shopId: 'armoury', itemId: SWORD });

    expect(res.status).toBe(403);
    expect(alice.inventory.items).toEqual([{ item: GOLD, quantity: 10 }]);
  });

  it('sells to a player still standing at the shop', async () => {
    const sim = createFixture(0);
    sim.addItem({
      id: SWORD,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    sim.map.tiles[5]![5]!.shop = 'armoury';
    const alice = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      inventory: { items: [{ item: GOLD, quantity: 10 }], maxCapacity: 10 },
    });
    read.during = () => {};

    const res = await request(app)
      .post('/shop/buy')
      .set('x-user', 'Alice')
      .send({ shopId: 'armoury', itemId: SWORD });

    expect(res.status).toBe(200);
    expect(alice.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
  });
});
