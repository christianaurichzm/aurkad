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
app.use((req: ExtendedRequest, _res, next) => {
  req.session = {
    username: 'op',
    accessLevel: Access.USER,
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
});
