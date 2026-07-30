/**
 * Moderation routes that act FROM the operator's own position.
 *
 * The /admin dashboard authenticates without joining the world, so these can
 * be called by a session that will never satisfy them. What is pinned here is
 * that the refusal says which of the two players is missing, so an operator
 * who is not in the world is not sent looking for a problem with the target.
 */
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createModRouter } from './modRoutes.js';
import { createFixture } from '../../sim/simFixture.js';
import { Access } from '../../../shared/types.js';

let app: express.Express;

// Each request declares its operator, standing in for the session middleware.
const fakeSession: express.RequestHandler = (req, _res, next) => {
  (req as unknown as { session: Record<string, unknown> }).session = {
    username: req.get('x-user'),
    accessLevel: Number(req.get('x-access') ?? Access.ADMIN),
    save: (cb: () => void) => cb(),
  };
  next();
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(fakeSession);
  app.use(createModRouter());
});

beforeEach(() => {
  createFixture(0);
});

const asOperator = (name: string) =>
  request(app).post('/mod/bring').set('x-user', name).set('x-access', '2');

describe('acting from the operator position', () => {
  it('refuses with the reason when the operator is not in the world', async () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });

    const res = await asOperator('Boss').send({ playerName: 'Alice' });

    expect(res.status).toBe(409);
    expect(res.text).toContain('game world');
  });

  it('still reports a missing target as a missing target', async () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Boss' });

    const res = await asOperator('Boss').send({ playerName: 'Ghost' });

    expect(res.status).toBe(404);
    expect(res.text).toContain('Player not found');
  });

  it('brings the target to the operator when both are in the world', async () => {
    const sim = createFixture(0);
    const boss = sim.addPlayer({ name: 'Boss' });
    const alice = sim.addPlayer({ name: 'Alice' });
    boss.position = { x: 320, y: 256 };

    await asOperator('Boss').send({ playerName: 'Alice' }).expect(200);

    expect(alice.position).toEqual(boss.position);
  });

  it('answers the same way for a teleport to a map', async () => {
    const res = await request(app)
      .post('/mod/gomap')
      .set('x-user', 'Boss')
      .set('x-access', '2')
      .send({ mapId: 'map1' });

    expect(res.status).toBe(409);
  });

  it('and for changing your own access', async () => {
    const res = await request(app)
      .post('/mod/setMyAccess')
      .set('x-user', 'Boss')
      .set('x-access', '2')
      .send({ accessLevel: Access.ADMIN });

    expect(res.status).toBe(409);
  });
});
