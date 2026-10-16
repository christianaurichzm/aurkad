/**
 * The files a player pulls from the game's asset folder (image sheets, their
 * atlas metadata, sounds and music), and the sheets an admin replaces from
 * the Art page, which must never leave one the client cannot cut. Express
 * does the transfer, so a track streams and a Range request works; these
 * pin who may ask, what may be asked for, and that no name leaves the folder.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SPRITE_LAYOUTS } from '../../../shared/mappings.js';
import { Access } from '../../../shared/types.js';

// checkAccess pulls in the audit trail, which registers a mongoose model at
// import time. The trail has its own tests.
vi.mock('../../services/auditService.js', () => ({
  recordAdminAction: vi.fn(),
  summarizeDetails: () => undefined,
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurkad-assets-'));
process.env['ASSETS_PATH'] = dir;

const { createAssetsRouter } = await import('./assetsRoutes.js');

// Not a real PNG: the route hands over bytes and never reads them.
const sheet = Buffer.from(
  Array.from({ length: 5000 }, (_, i) => (i * 7) % 256),
);
const body = 'ID3 not really, but bytes are bytes'.repeat(20);

let session: { username?: string; accessLevel?: Access } = {};
let app: express.Express;

beforeAll(() => {
  fs.writeFileSync(path.join(dir, 'tiles.png'), sheet);
  fs.writeFileSync(path.join(dir, 'theme.mp3'), body);
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'not for you');
  app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = session;
    next();
  });
  app.use(createAssetsRouter());
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('GET /assets/:name.png', () => {
  it('sends the sheet as it is on disk', async () => {
    session = { username: 'Alice' };

    const res = await request(app).get('/assets/tiles.png').buffer();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.body).toEqual(sheet);
  });

  it('refuses a request with no session', async () => {
    session = {};

    const res = await request(app).get('/assets/tiles.png');

    expect(res.status).toBe(401);
  });

  it('404s a name that is not a known sheet', async () => {
    session = { username: 'Alice' };

    const res = await request(app).get('/assets/nonsense.png');

    expect(res.status).toBe(404);
  });
});

describe('GET /audio/:filename', () => {
  it('sends the file with the type its extension says', async () => {
    session = { username: 'Alice' };

    const res = await request(app).get('/audio/theme.mp3').buffer();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect((res.body as Buffer).toString()).toBe(body);
  });

  // The reason this route hands the transfer to express instead of reading the
  // file: a track is seekable only if a range can be asked for.
  it('answers a range with just that range', async () => {
    session = { username: 'Alice' };

    const res = await request(app)
      .get('/audio/theme.mp3')
      .set('Range', 'bytes=0-9')
      .buffer();

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-9/${body.length}`);
    expect((res.body as Buffer).toString()).toBe(body.slice(0, 10));
  });

  it('refuses a request with no session', async () => {
    session = {};

    const res = await request(app).get('/audio/theme.mp3');

    expect(res.status).toBe(401);
  });

  it('refuses an extension that is not audio', async () => {
    session = { username: 'Alice' };

    const res = await request(app).get('/audio/secret.txt');

    expect(res.status).toBe(400);
  });

  it('404s a sound the game names but never shipped', async () => {
    session = { username: 'Alice' };

    const res = await request(app).get('/audio/missing.mp3');

    expect(res.status).toBe(404);
  });

  it('cannot be walked out of the asset directory', async () => {
    session = { username: 'Alice' };

    const res = await request(app).get('/audio/..%2f..%2fpackage.json');

    expect(res.status).not.toBe(200);
  });
});

describe('optional isometric atlas metadata', () => {
  it('requires a session, defaults to an empty atlas and serves configured frames', async () => {
    session = {};
    expect((await request(app).get('/assets/tiles.json')).status).toBe(401);
    session = { username: 'Alice' };
    expect((await request(app).get('/assets/tiles.json')).body).toEqual({});
    const frames = {
      0: {
        x: 0,
        y: 64,
        width: 128,
        height: 256,
        drawWidth: 128,
        drawHeight: 256,
        anchorX: 64,
        anchorY: 224,
      },
    };
    fs.writeFileSync(path.join(dir, 'tiles.json'), JSON.stringify(frames));
    expect((await request(app).get('/assets/tiles.json')).body).toEqual(frames);
  });

  it('serves the sprite frame metadata the same way', async () => {
    session = {};
    expect((await request(app).get('/assets/sprites.json')).status).toBe(401);
    session = { username: 'Alice' };
    expect((await request(app).get('/assets/sprites.json')).body).toEqual({});
    const sprites = { width: 96, height: 96, anchorX: 48, anchorY: 84 };
    fs.writeFileSync(path.join(dir, 'sprites.json'), JSON.stringify(sprites));
    expect((await request(app).get('/assets/sprites.json')).body).toEqual(
      sprites,
    );
  });
});

/** The signature and IHDR of a w x h PNG: all the route reads of one. */
const png = (width: number, height: number) => {
  const size = Buffer.alloc(8);
  size.writeUInt32BE(width, 0);
  size.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from('IHDR'),
    size,
    Buffer.from([8, 6, 0, 0, 0, 0, 0, 0, 0]),
  ]);
};
const put = (url: string, bytes: Buffer) =>
  request(app).put(url).set('Content-Type', 'image/png').send(bytes);
const onDisk = (name: string) => fs.readFileSync(path.join(dir, name));

describe('PUT /admin/assets/:sheet', () => {
  it.each([
    ['nobody', {}, 401],
    ['a moderator', { username: 'Mo', accessLevel: Access.MOD }, 403],
  ])('is closed to %s', async (_, who, status) => {
    session = who;

    expect((await put('/admin/assets/items', png(64, 64))).status).toBe(status);
    expect(fs.existsSync(path.join(dir, 'items.png'))).toBe(false);
  });

  it('replaces a sheet cut on its grid, and refuses one that is not', async () => {
    session = { username: 'Op', accessLevel: Access.ADMIN };

    expect((await put('/admin/assets/items', png(320, 64))).status).toBe(204);
    const refused = await put('/admin/assets/items', png(300, 64));

    expect(refused.status).toBe(422);
    expect(refused.body.error).toContain('64 px');
    expect(onDisk('items.png')).toEqual(png(320, 64));
  });

  it('refuses what is not a PNG, and a sheet or a layout it does not know', async () => {
    session = { username: 'Op', accessLevel: Access.ADMIN };

    expect((await put('/admin/assets/spells', sheet)).status).toBe(422);
    expect(
      (
        await request(app)
          .put('/admin/assets/spells')
          .set('Content-Type', 'image/gif')
          .send(sheet)
      ).status,
    ).toBe(415);
    expect((await put('/admin/assets/music', png(32, 32))).status).toBe(404);
    expect(
      (await put('/admin/assets/sprites?layout=three-16', png(32, 32))).status,
    ).toBe(400);
    expect(
      (await put('/admin/assets/items?layout=aurkad', png(64, 64))).status,
    ).toBe(400);
    expect(fs.existsSync(path.join(dir, 'spells.png'))).toBe(false);
  });

  it('writes the sprites.json of the layout a character sheet was drawn in', async () => {
    session = { username: 'Op', accessLevel: Access.ADMIN };
    const kept = onDisk('sprites.json');

    // Eight characters of three 32 px frames, sent as if they were 48 px.
    const wrong = await put(
      '/admin/assets/sprites?layout=three-48',
      png(384, 256),
    );
    expect(wrong.status).toBe(422);
    expect(onDisk('sprites.json')).toEqual(kept);

    expect(
      (await put('/admin/assets/sprites?layout=three-32', png(384, 256)))
        .status,
    ).toBe(204);
    expect(JSON.parse(onDisk('sprites.json').toString())).toEqual(
      SPRITE_LAYOUTS['three-32'],
    );

    // Without a layout the one there stays, whatever the sheet measures.
    expect((await put('/admin/assets/sprites', png(100, 100))).status).toBe(
      204,
    );
    expect(JSON.parse(onDisk('sprites.json').toString())).toEqual(
      SPRITE_LAYOUTS['three-32'],
    );
  });

  it('refuses tiles that would leave a frame of tiles.json outside the sheet', async () => {
    session = { username: 'Op', accessLevel: Access.ADMIN };
    // tiles.json places frame 0 at 0,64 and 128 x 256 (the test above).

    const small = await put('/admin/assets/tiles', png(128, 256));
    expect(small.status).toBe(422);
    expect(onDisk('tiles.png')).toEqual(sheet);

    expect((await put('/admin/assets/tiles', png(130, 320))).status).toBe(204);
  });
});
