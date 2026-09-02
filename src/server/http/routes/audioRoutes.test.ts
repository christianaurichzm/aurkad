/**
 * Sounds and music, the only files a player pulls unencoded. Express does
 * the transfer, so a track streams and a Range request works; these pin who
 * may ask, what may be asked for, and that no name leaves the asset folder.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurkad-audio-'));
process.env['ASSETS_PATH'] = dir;

const { createAudioRouter } = await import('./audioRoutes.js');

const body = 'ID3 not really, but bytes are bytes'.repeat(20);

let session: { username?: string } = {};
let app: express.Express;

beforeAll(() => {
  fs.writeFileSync(path.join(dir, 'theme.mp3'), body);
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'not for you');
  app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = session;
    next();
  });
  app.use(createAudioRouter());
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

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
