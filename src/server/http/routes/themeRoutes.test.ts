import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type NextFunction, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';

// checkAccess pulls in the audit trail, which registers a mongoose model at
// import time. The trail has its own tests.
vi.mock('../../services/auditService.js', () => ({
  recordAdminAction: vi.fn(),
  summarizeDetails: () => undefined,
}));

import { handleRouteError } from '../../app.js';
import { createThemeRouter } from './themeRoutes.js';

let themeDir: string;

beforeEach(() => {
  themeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-routes-'));
});

afterEach(() => {
  fs.rmSync(themeDir, { recursive: true, force: true });
});

const appFor = (accessLevel: Access | undefined) => {
  const app = express();
  app.use((req: ExtendedRequest, _res: Response, next: NextFunction) => {
    req.session = {
      ...(accessLevel !== undefined && { username: 'op', accessLevel }),
    } as ExtendedRequest['session'];
    next();
  });
  app.use(express.json());
  app.use(createThemeRouter({ themeDir }));
  app.use(handleRouteError);
  return app;
};
const appAs = () => appFor(Access.ADMIN);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const CHOICES = { colors: { primary: '#aa5500' }, layout: 'left' };

describe('themeRoutes', () => {
  it.each([
    ['nobody', undefined, 401],
    ['a moderator', Access.MOD, 403],
  ])('is closed to %s, reading or writing', async (_, access, status) => {
    const app = appFor(access);

    expect((await request(app).get('/admin/theme')).status).toBe(status);
    expect((await request(app).put('/admin/theme').send(CHOICES)).status).toBe(
      status,
    );
    expect(
      (
        await request(app)
          .put('/admin/theme/logo')
          .set('Content-Type', 'image/png')
          .send(PNG)
      ).status,
    ).toBe(status);
    expect((await request(app).delete('/admin/theme/logo')).status).toBe(
      status,
    );
    expect(fs.readdirSync(themeDir)).toEqual([]);
  });

  it('answers the defaults for a game with no theme, and says when a theme.css has rules', async () => {
    expect((await request(appAs()).get('/admin/theme')).body).toEqual({
      theme: { colors: {}, layout: 'right', art: 'pixel', dialogDim: true },
      handwritten: false,
    });

    fs.writeFileSync(
      path.join(themeDir, 'theme.css'),
      "/* This game's look.\n   :root { --color-primary: #d9822b; } */\n",
    );
    expect((await request(appAs()).get('/admin/theme')).body.handwritten).toBe(
      false,
    );

    fs.writeFileSync(path.join(themeDir, 'theme.css'), ':root {}');

    expect((await request(appAs()).get('/admin/theme')).body.handwritten).toBe(
      true,
    );
  });

  it('saves the choices, which the next read answers', async () => {
    const saved = await request(appAs()).put('/admin/theme').send(CHOICES);

    expect(saved.status).toBe(200);
    expect((await request(appAs()).get('/admin/theme')).body.theme).toEqual({
      ...CHOICES,
      art: 'pixel',
      dialogDim: true,
    });
  });

  it.each([
    ['a colour that is CSS', { colors: { primary: 'red; } body { x: y' } }],
    ['a picture named by hand', { logo: 'logo-0123abcd.png' }],
  ])('refuses %s and writes nothing', async (_, body) => {
    const res = await request(appAs()).put('/admin/theme').send(body);

    expect(res.status).toBe(400);
    expect(fs.readdirSync(themeDir)).toEqual([]);
  });

  it('takes a picture, then takes it away', async () => {
    const put = await request(appAs())
      .put('/admin/theme/logo')
      .set('Content-Type', 'image/png')
      .send(PNG);

    expect(put.status).toBe(200);
    expect(put.body.logo).toMatch(/^logo-[0-9a-f]{8}\.png$/);
    expect(fs.existsSync(path.join(themeDir, put.body.logo as string))).toBe(
      true,
    );

    const gone = await request(appAs()).delete('/admin/theme/logo');

    expect(gone.body.logo).toBeUndefined();
    expect(fs.readdirSync(themeDir)).toEqual(['theme.json']);
  });

  it.each([
    ['a script that says it is a PNG', 'image/png', '<svg onload="x()"/>'],
    ['a type that is no picture', 'image/svg+xml', '<svg/>'],
  ])('refuses %s', async (_, type, body) => {
    const res = await request(appAs())
      .put('/admin/theme/logo')
      .set('Content-Type', type)
      .send(Buffer.from(body));

    expect(res.status).toBe(415);
    expect(fs.readdirSync(themeDir)).toEqual([]);
  });

  it('refuses a picture past the limit', async () => {
    const res = await request(appAs())
      .put('/admin/theme/background')
      .set('Content-Type', 'image/png')
      .send(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));

    expect(res.status).toBe(413);
    expect(fs.readdirSync(themeDir)).toEqual([]);
  });

  it('has no slot but the two', async () => {
    const res = await request(appAs())
      .put('/admin/theme/theme.json')
      .set('Content-Type', 'image/png')
      .send(PNG);

    expect(res.status).toBe(404);
    expect(fs.readdirSync(themeDir)).toEqual([]);
  });
});
