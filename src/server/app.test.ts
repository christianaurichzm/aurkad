import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouter, handleRouteError } from './app.js';
import { logger } from './logger.js';

function appWith(mount: (router: express.Router) => void) {
  const router = createRouter();
  mount(router);
  const app = express();
  app.use(router);
  app.use(handleRouteError);
  return app;
}

beforeEach(() => {
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

describe('createRouter', () => {
  it('answers 500 when an async handler rejects', async () => {
    const app = appWith((router) => {
      router.get('/boom', async () => {
        await Promise.resolve();
        throw new Error('mongo went away');
      });
    });

    const res = await request(app).get('/boom');

    // Without the wrapper Express 4 never responds to this request at all, and
    // Node exits on the unhandled rejection.
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('answers 500 when a synchronous handler throws', async () => {
    const app = appWith((router) => {
      router.get('/throws', () => {
        throw new Error('bad input');
      });
    });

    expect((await request(app).get('/throws')).status).toBe(500);
  });

  it('keeps the failure detail out of the body and in the log', async () => {
    const app = appWith((router) => {
      router.get('/secret', async () => {
        await Promise.resolve();
        throw new Error('connection string leaked here');
      });
    });

    const res = await request(app).get('/secret');

    expect(JSON.stringify(res.body)).not.toContain('connection string');
    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled error in route',
      expect.objectContaining({ method: 'GET', path: '/secret' }),
    );
  });

  it('leaves a handler that already answered alone', async () => {
    const app = appWith((router) => {
      router.get('/late', async (_req, res) => {
        res.status(201).json({ ok: true });
        await Promise.resolve();
        throw new Error('after the response');
      });
    });

    const res = await request(app).get('/late');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });

  it('passes through handlers that succeed, sync and async alike', async () => {
    const app = appWith((router) => {
      router.get('/sync', (_req, res) => {
        res.json({ from: 'sync' });
      });
      router.post('/async', async (_req, res) => {
        await Promise.resolve();
        res.json({ from: 'async' });
      });
    });

    expect((await request(app).get('/sync')).body).toEqual({ from: 'sync' });
    expect((await request(app).post('/async')).body).toEqual({ from: 'async' });
  });

  it('still runs middleware chains in order', async () => {
    const seen: string[] = [];
    const app = appWith((router) => {
      router.use((_req, _res, next) => {
        seen.push('middleware');
        next();
      });
      router.get(
        '/chain',
        (_req, _res, next) => {
          seen.push('guard');
          next();
        },
        (_req, res) => {
          seen.push('handler');
          res.json({ ok: true });
        },
      );
    });

    await request(app).get('/chain');

    expect(seen).toEqual(['middleware', 'guard', 'handler']);
  });

  it('lets an async middleware reject without stranding the request', async () => {
    const app = appWith((router) => {
      router.get(
        '/guarded',
        async () => {
          await Promise.resolve();
          throw new Error('session lookup failed');
        },
        (_req, res) => {
          res.json({ reached: true });
        },
      );
    });

    expect((await request(app).get('/guarded')).status).toBe(500);
  });
});
