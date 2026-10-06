import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';

const { player } = vi.hoisted(() => ({
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
}));
vi.mock('../../services/player/playerService.js', () => ({
  getPlayerById: () => Promise.resolve(player),
}));
vi.mock('../../sim/world.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sim/world.js')>()),
  updatePlayer: vi.fn(),
}));
vi.mock('../../services/auditService.js', () => ({
  recordAdminAction: vi.fn(),
  summarizeDetails: () => undefined,
}));

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
});
