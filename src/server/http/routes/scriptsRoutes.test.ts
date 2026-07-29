import express, { type NextFunction, type Response } from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';

vi.mock('../../engine/scripting/scriptsRepository.js', () => ({
  listScriptFiles: vi.fn(),
  readScriptFile: vi.fn(),
  writeScriptFile: vi.fn(),
  createScriptFile: vi.fn(),
  deleteScriptFile: vi.fn(),
  readTypeDefs: vi.fn(),
}));

import { createScriptsRouter } from './scriptsRoutes.js';
import {
  recordScriptError,
  clearScriptErrors,
} from '../../engine/scripting/scriptErrors.js';
import * as repo from '../../engine/scripting/scriptsRepository.js';

function appAs(accessLevel: Access | undefined) {
  const app = express();
  app.use(express.json());
  app.use((req: ExtendedRequest, _res: Response, next: NextFunction) => {
    req.session = {
      ...(accessLevel !== undefined && {
        username: 'op',
        accessLevel,
      }),
    } as ExtendedRequest['session'];
    next();
  });
  app.use(createScriptsRouter());
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('access gating', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(appAs(undefined)).get('/admin/scripts');
    expect(res.status).toBe(401);
  });

  it('rejects a MOD (non-ADMIN) request with 403', async () => {
    const res = await request(appAs(Access.MOD)).get('/admin/scripts');
    expect(res.status).toBe(403);
  });

  it('allows an ADMIN request', async () => {
    vi.mocked(repo.listScriptFiles).mockReturnValue([]);
    const res = await request(appAs(Access.ADMIN)).get('/admin/scripts');
    expect(res.status).toBe(200);
  });
});

describe('flag disabled', () => {
  it('404s when the router is never mounted', async () => {
    const app = express();
    const res = await request(app).get('/admin/scripts');
    expect(res.status).toBe(404);
  });
});

describe('GET /admin/scripts/:name', () => {
  it('returns 404 for a missing or invalid script', async () => {
    vi.mocked(repo.readScriptFile).mockReturnValue(null);
    const res = await request(appAs(Access.ADMIN)).get(
      '/admin/scripts/missing.js',
    );
    expect(res.status).toBe(404);
  });

  it('returns the file content', async () => {
    vi.mocked(repo.readScriptFile).mockReturnValue('console.log(1);');
    const res = await request(appAs(Access.ADMIN)).get('/admin/scripts/a.js');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'a.js', content: 'console.log(1);' });
  });
});

describe('PUT /admin/scripts/:name', () => {
  it('rejects an invalid script name with 400', async () => {
    vi.mocked(repo.writeScriptFile).mockReturnValue(false);
    const res = await request(appAs(Access.ADMIN))
      .put('/admin/scripts/whatever.js')
      .send({ content: 'x' });
    expect(res.status).toBe(400);
  });

  it('saves valid content', async () => {
    vi.mocked(repo.writeScriptFile).mockReturnValue(true);
    const res = await request(appAs(Access.ADMIN))
      .put('/admin/scripts/a.js')
      .send({ content: 'x' });
    expect(res.status).toBe(200);
  });
});

describe('POST /admin/scripts', () => {
  it('creates a new file', async () => {
    vi.mocked(repo.createScriptFile).mockReturnValue('created');
    const res = await request(appAs(Access.ADMIN))
      .post('/admin/scripts')
      .send({ name: 'new.js' });
    expect(res.status).toBe(201);
  });

  it('returns 409 when the file already exists', async () => {
    vi.mocked(repo.createScriptFile).mockReturnValue('exists');
    const res = await request(appAs(Access.ADMIN))
      .post('/admin/scripts')
      .send({ name: 'a.js' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /admin/scripts/:name', () => {
  it('returns 404 for a missing file', async () => {
    vi.mocked(repo.deleteScriptFile).mockReturnValue(false);
    const res = await request(appAs(Access.ADMIN)).delete(
      '/admin/scripts/missing.js',
    );
    expect(res.status).toBe(404);
  });

  it('deletes an existing file', async () => {
    vi.mocked(repo.deleteScriptFile).mockReturnValue(true);
    const res = await request(appAs(Access.ADMIN)).delete(
      '/admin/scripts/a.js',
    );
    expect(res.status).toBe(204);
  });
});

describe('GET /admin/scripts/errors', () => {
  beforeEach(() => {
    clearScriptErrors();
  });

  it('is ADMIN gated like the rest of the router', async () => {
    const res = await request(appAs(Access.MOD)).get('/admin/scripts/errors');
    expect(res.status).toBe(403);
  });

  it('returns an empty list when nothing has failed', async () => {
    const res = await request(appAs(Access.ADMIN)).get('/admin/scripts/errors');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns the recorded failures with their positions', async () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at quest.js:11:3';
    recordScriptError('quest.js', err, 'hook', 'playerJoin');

    const res = await request(appAs(Access.ADMIN)).get('/admin/scripts/errors');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      script: 'quest.js',
      line: 11,
      column: 3,
      source: 'hook',
      context: 'playerJoin',
    });
  });

  // Route order matters: a file named "errors" must not shadow this, and this
  // must not swallow a request for a real file.
  it('does not shadow reading a script file', async () => {
    vi.mocked(repo.readScriptFile).mockReturnValue('// hi');

    const res = await request(appAs(Access.ADMIN)).get(
      '/admin/scripts/quest.js',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'quest.js', content: '// hi' });
  });
});
