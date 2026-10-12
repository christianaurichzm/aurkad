import express from 'express';
import request from 'supertest';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { ExtendedRequest } from '../session.js';
import { Access, PlayerServer } from '../../../shared/types.js';

const { player, db } = vi.hoisted(() => ({
  player: {
    id: 'p1',
    name: 'op',
    health: 300,
    maxHealth: 300,
    vitality: 0,
    attack: 0,
    strength: 0,
    defense: 0,
    agility: 0,
    unspentPoints: 5,
  },
  db: {
    findById: vi.fn(),
    addStatsOffline: vi.fn(),
  },
}));
vi.mock('../../services/player/playerService.js', () => ({
  getPlayerById: db.findById,
  addStatsOffline: db.addStatsOffline,
}));
vi.mock('../../sim/world.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sim/world.js')>()),
  updatePlayer: vi.fn(),
}));
vi.mock('../../services/auditService.js', () => ({
  recordAdminAction: vi.fn(),
  summarizeDetails: () => undefined,
}));

const { getPlayerById, registerPlayer, unregisterPlayer } =
  await import('../../sim/world.js');
import { createPlayerRouter } from './playerRoutes.js';

const app = express();
app.use(express.json());
// The player 'op' unless a request says otherwise.
app.use((req: ExtendedRequest, _res, next) => {
  req.session = {
    username: req.get('x-user') ?? 'op',
    accessLevel: Number(req.get('x-access') ?? Access.USER),
  } as ExtendedRequest['session'];
  next();
});
app.use(createPlayerRouter());

beforeEach(() => {
  db.findById.mockReset();
  db.addStatsOffline.mockReset();
  unregisterPlayer('p1');
  registerPlayer(player as unknown as PlayerServer);
});

describe('spending attribute points', () => {
  it('adds what vitality gives to the health ceiling the player had', async () => {
    await request(app)
      .post('/players/p1/assignPoints')
      .send({ vitality: 2, strength: 1 })
      .expect(200);

    expect(player.maxHealth).toBe(320);
    expect(player.strength).toBe(1);
    expect(player.unspentPoints).toBe(2);
  });

  // The id is in the path, so the gate's "logged in" is not enough: anyone
  // could put another player's id there.
  it("refuses to spend another player's points", async () => {
    const before = { ...player };

    await request(app)
      .post('/players/p1/assignPoints')
      .set('x-user', 'mallory')
      .send({ attack: 1 })
      .expect(403);

    expect(player).toEqual(before);
  });

  it("lets an admin spend them on the player's behalf", async () => {
    const { attack, unspentPoints } = player;

    await request(app)
      .post('/players/p1/assignPoints')
      .set('x-user', 'gm')
      .set('x-access', String(Access.ADMIN))
      .send({ attack: 1 })
      .expect(200);

    expect(player.attack).toBe(attack + 1);
    expect(player.unspentPoints).toBe(unspentPoints - 1);
  });

  // The document trails the world by a snapshot. A copy read from it and put
  // back in the world would drop whatever the player picked up since, and
  // carry the account's password hash into what the snapshot writes.
  it('changes the character in the world, never a copy from the database', async () => {
    const live = getPlayerById('p1')!;
    live.inventory = { items: [{ item: 7, quantity: 1 }], maxCapacity: 10 };
    db.findById.mockResolvedValue({
      ...live,
      inventory: { items: [], maxCapacity: 10 },
      password: 'hash',
    });
    const { unspentPoints } = live;

    await request(app)
      .post('/players/p1/assignPoints')
      .send({ defense: 1 })
      .expect(200);

    expect(getPlayerById('p1')).toBe(live);
    expect(live.inventory.items).toEqual([{ item: 7, quantity: 1 }]);
    expect(live).not.toHaveProperty('password');
    expect(live.unspentPoints).toBe(unspentPoints - 1);
    expect(db.findById).not.toHaveBeenCalled();
  });

  it('writes an offline character to its document without bringing it into the world', async () => {
    unregisterPlayer('p1');
    db.findById.mockResolvedValue({ ...player, unspentPoints: 3 });
    db.addStatsOffline.mockResolvedValue({
      ...player,
      vitality: 1,
      maxHealth: 310,
      unspentPoints: 2,
    });

    const res = await request(app)
      .post('/players/p1/assignPoints')
      .send({ vitality: 1 })
      .expect(200);

    expect(db.addStatsOffline).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        vitality: 1,
        maxHealth: 10,
        unspentPoints: -1,
      }),
    );
    expect(res.body.maxHealth).toBe(310);
    expect(getPlayerById('p1')).toBeUndefined();
  });

  it('refuses a character another instance is playing', async () => {
    unregisterPlayer('p1');
    db.findById.mockResolvedValue({ ...player, unspentPoints: 3 });
    db.addStatsOffline.mockResolvedValue(null);

    await request(app)
      .post('/players/p1/assignPoints')
      .send({ attack: 1 })
      .expect(409);
  });
});
