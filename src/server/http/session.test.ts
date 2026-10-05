/**
 * Whether a session still speaks for the account it was minted from.
 *
 * The middleware is mounted here the way `server.ts` mounts it, with only the
 * store swapped, because the whole point of the check is where it sits: it is
 * the one handler both the HTTP app and the WebSocket upgrade already run, so
 * a test that mounted the guard by itself would prove nothing about the app
 * the server actually builds.
 */
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSessionMiddleware, type ExtendedRequest } from './session.js';
import { playersByName } from '../sim/state.js';
import type { PlayerServer } from '../../shared/types.js';

const authOf =
  vi.fn<
    (name: string) => Promise<{ authEpoch: number; access: number } | null>
  >();
vi.mock('../persistence/playerRepository.js', () => ({
  playerRepository: {
    authOf: (name: string) => authOf(name),
  },
}));
/** The account as the database has it: generation `authEpoch`, ADMIN. */
const account = (authEpoch: number, access = 2) => ({ authEpoch, access });

/**
 * An app that mints a session on /login and reports who the next request is
 * seen as, which is the only thing the guard changes.
 */
function createApp(store: session.Store = new session.MemoryStore()) {
  const app = express();
  app.use(express.json());
  app.use(createSessionMiddleware(store));
  app.post('/login', (req: ExtendedRequest, res) => {
    req.session.username = 'Alice';
    req.session.accessLevel = 2;
    req.session.authEpoch = Number(req.query['epoch'] ?? 0);
    req.session.save(() => res.status(200).end());
  });
  app.get('/whoami', (req: ExtendedRequest, res) => {
    res.json({
      username: req.session.username ?? null,
      accessLevel: req.session.accessLevel ?? null,
    });
  });
  return app;
}

describe('session identity against the account generation', () => {
  beforeEach(() => {
    authOf.mockReset();
    playersByName.clear();
  });

  it('keeps a session whose generation still matches the account', async () => {
    authOf.mockResolvedValue(account(0));
    const agent = request.agent(createApp());
    await agent.post('/login').expect(200);

    const res = await agent.get('/whoami').expect(200);
    expect(res.body).toEqual({ username: 'Alice', accessLevel: 2 });
  });

  it('drops the identity of a session the account has moved past', async () => {
    authOf.mockResolvedValue(account(0));
    const agent = request.agent(createApp());
    await agent.post('/login').expect(200);

    // What a password reset does.
    authOf.mockResolvedValue(account(1));

    const res = await agent.get('/whoami').expect(200);
    expect(res.body).toEqual({ username: null, accessLevel: null });
  });

  it('acts at the level the account has now, not the one it logged in at', async () => {
    authOf.mockResolvedValue(account(0));
    const agent = request.agent(createApp());
    await agent.post('/login').expect(200);

    // A demotion: the session stays, its rights go.
    authOf.mockResolvedValue(account(0, 0));

    const res = await agent.get('/whoami').expect(200);
    expect(res.body).toEqual({ username: 'Alice', accessLevel: 0 });
  });

  it('takes the level of the player in this world over the database', async () => {
    authOf.mockResolvedValue(account(0, 0));
    const agent = request.agent(createApp());
    await agent.post('/login').expect(200);

    // Changed in place by a GM command, ahead of the snapshot.
    playersByName.set('Alice', { access: 1 } as PlayerServer);

    const res = await agent.get('/whoami').expect(200);
    expect(res.body.accessLevel).toBe(1);
  });

  it('drops the identity of a session naming an account that is gone', async () => {
    authOf.mockResolvedValue(account(0));
    const agent = request.agent(createApp());
    await agent.post('/login').expect(200);

    authOf.mockResolvedValue(null);

    const res = await agent.get('/whoami').expect(200);
    expect(res.body.username).toBeNull();
  });

  it('treats a session minted before the field as generation zero', async () => {
    // Sessions minted before the generation existed carry none, and logging
    // everyone out on a deploy would be worse than what the generation fixes.
    authOf.mockResolvedValue(account(0));
    const app = express();
    app.use(createSessionMiddleware(new session.MemoryStore()));
    app.post('/legacy-login', (req: ExtendedRequest, res) => {
      req.session.username = 'Alice';
      req.session.accessLevel = 2;
      req.session.save(() => res.status(200).end());
    });
    app.get('/whoami', (req: ExtendedRequest, res) => {
      res.json({ username: req.session.username ?? null });
    });
    const agent = request.agent(app);
    await agent.post('/legacy-login').expect(200);

    const res = await agent.get('/whoami').expect(200);
    expect(res.body.username).toBe('Alice');
  });

  it('drops the identity when the account cannot be read at all', async () => {
    authOf.mockResolvedValue(account(0));
    const agent = request.agent(createApp());
    await agent.post('/login').expect(200);

    // Failing open would let anyone able to flake the database skip the check.
    authOf.mockRejectedValue(new Error('mongo is down'));

    const res = await agent.get('/whoami').expect(200);
    expect(res.body.username).toBeNull();
  });

  // The store answers from its own callback, outside any request handler, so
  // a session read there that throws is an uncaughtException, and the server
  // ends the process on one.
  it('answers an error when the session store cannot be read', async () => {
    authOf.mockResolvedValue(account(0));
    const store = new session.MemoryStore();
    const agent = request.agent(createApp(store));
    await agent.post('/login').expect(200);

    store.get = (_sid, callback) =>
      setImmediate(() => callback(new Error('mongo is down')));

    await agent.get('/whoami').expect(500);
  });

  it('does not query the account for a request that names nobody', async () => {
    await request(createApp()).get('/whoami').expect(200);
    expect(authOf).not.toHaveBeenCalled();
  });
});
