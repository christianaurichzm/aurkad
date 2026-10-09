/**
 * The files a player pulls from the game's asset folder: the image sheets,
 * their atlas metadata, and sounds and music. Express does the transfer, so
 * a track streams and a Range request works; these pin who may ask, what
 * may be asked for, and that no name leaves the folder.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurkad-assets-'));
process.env['ASSETS_PATH'] = dir;

const { createAssetsRouter } = await import('./assetsRoutes.js');

// Not a real PNG: the route hands over bytes and never reads them.
const sheet = Buffer.from(
  Array.from({ length: 5000 }, (_, i) => (i * 7) % 256),
);
const body = 'ID3 not really, but bytes are bytes'.repeat(20);

let session: { username?: string } = {};
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
