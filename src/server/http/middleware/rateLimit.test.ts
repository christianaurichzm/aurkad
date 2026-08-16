/**
 * What counts as "one caller".
 *
 * The counting is the library's job. The key is ours, and it is the half that
 * fails quietly: a limit keyed on the wrong thing still returns 429s, still
 * looks like it works, and either lets an abuser through or locks out
 * everybody who shares an address with them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const ENV_KEYS = ['HTTP_RATE_LIMIT_MAX', 'HTTP_RATE_LIMIT_WINDOW_MS'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

/**
 * An app with the limiter mounted the way server.ts mounts it: after whatever
 * populates the session. `x-user` stands in for a logged-in caller.
 *
 * The limiter reads its numbers when it is created, so each case re-imports
 * the module with the env it needs.
 */
async function appWithLimiter({
  max = 2,
  trustProxy = false,
}: { max?: number; trustProxy?: boolean | number } = {}) {
  vi.resetModules();
  process.env.HTTP_RATE_LIMIT_MAX = String(max);
  process.env.HTTP_RATE_LIMIT_WINDOW_MS = '60000';
  const { createHttpLimiter } = await import('./rateLimit.js');

  const app = express();
  app.set('trust proxy', trustProxy);
  app.use((req, _res, next) => {
    const username = req.get('x-user');
    (req as unknown as { session: Record<string, unknown> }).session = username
      ? { username }
      : {};
    next();
  });
  app.use(createHttpLimiter());
  app.get('/thing', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('http rate limit', () => {
  it('answers up to the limit and then refuses', async () => {
    const app = await appWithLimiter({ max: 2 });

    expect((await request(app).get('/thing')).status).toBe(200);
    expect((await request(app).get('/thing')).status).toBe(200);

    const refused = await request(app).get('/thing');
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: expect.any(String) });
  });

  // Address is a poor stand-in for a person: a household, a school or a mobile
  // carrier is one address and many players.
  it('counts logged-in callers by name, so one cannot spend another budget', async () => {
    const app = await appWithLimiter({ max: 1 });

    expect(
      (await request(app).get('/thing').set('x-user', 'alice')).status,
    ).toBe(200);
    expect(
      (await request(app).get('/thing').set('x-user', 'alice')).status,
    ).toBe(429);

    // Same address, different session: untouched.
    expect((await request(app).get('/thing').set('x-user', 'bob')).status).toBe(
      200,
    );
  });

  it('falls back to the address before anyone has logged in', async () => {
    const app = await appWithLimiter({ max: 1 });

    expect((await request(app).get('/thing')).status).toBe(200);
    expect((await request(app).get('/thing')).status).toBe(429);
  });

  // The reason config.http.trustProxy exists. Both halves matter: believing
  // the header when nobody is in front lets a caller choose their own bucket,
  // and not believing it when a proxy IS in front puts every player in one.
  describe('X-Forwarded-For', () => {
    it('is ignored while no proxy is configured', async () => {
      // The library logs once about the header being set without trust proxy,
      // which is the misconfiguration this case is reproducing.
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const app = await appWithLimiter({ max: 1, trustProxy: false });

      expect(
        (await request(app).get('/thing').set('x-forwarded-for', '1.1.1.1'))
          .status,
      ).toBe(200);
      // A different claimed address, and still the same bucket.
      expect(
        (await request(app).get('/thing').set('x-forwarded-for', '2.2.2.2'))
          .status,
      ).toBe(429);
    });

    it('separates callers once a proxy is configured', async () => {
      const app = await appWithLimiter({ max: 1, trustProxy: 1 });

      expect(
        (await request(app).get('/thing').set('x-forwarded-for', '1.1.1.1'))
          .status,
      ).toBe(200);
      expect(
        (await request(app).get('/thing').set('x-forwarded-for', '2.2.2.2'))
          .status,
      ).toBe(200);
      expect(
        (await request(app).get('/thing').set('x-forwarded-for', '1.1.1.1'))
          .status,
      ).toBe(429);
    });
  });
});
