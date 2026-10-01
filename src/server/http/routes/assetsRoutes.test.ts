/**
 * The spritesheets, which leave the server XORed with a key that belongs to
 * one session. The obfuscation is only worth what its reversibility is
 * worth, so these hold that the bytes come back exactly on the key the
 * session was given, and that two sessions never receive the same bytes
 * for the same sheet.
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
const original = Buffer.from(
  Array.from({ length: 5000 }, (_, i) => (i * 7) % 256),
);

let session: { username?: string; assetKey?: string } = {};
let app: express.Express;

const xor = (data: Buffer, hexKey: string): Buffer => {
  const key = Buffer.from(hexKey, 'hex');
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i]! ^ key[i % key.length]!;
  }
  return out;
};

beforeAll(() => {
  fs.writeFileSync(path.join(dir, 'tiles.png'), original);
  app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = session;
    next();
  });
  app.use(createAssetsRouter());
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('GET /assets/:name.bin', () => {
  it('sends the file XORed with the key of the session asking', async () => {
    session = { username: 'Alice', assetKey: 'a1b2c3d4'.repeat(8) };

    const res = await request(app).get('/assets/tiles.bin').buffer();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(xor(res.body as Buffer, session.assetKey!)).toEqual(original);
  });

  it('gives two sessions different bytes for the same sheet', async () => {
    session = { username: 'Alice', assetKey: '11'.repeat(32) };
    const first = await request(app).get('/assets/tiles.bin').buffer();

    session = { username: 'Bob', assetKey: '22'.repeat(32) };
    const second = await request(app).get('/assets/tiles.bin').buffer();

    expect(first.body).not.toEqual(second.body);
    expect(xor(second.body as Buffer, '22'.repeat(32))).toEqual(original);
  });

  it('refuses a request with no session', async () => {
    session = {};

    const res = await request(app).get('/assets/tiles.bin');

    expect(res.status).toBe(401);
  });

  it('refuses a session that was never given a key', async () => {
    session = { username: 'Alice' };

    const res = await request(app).get('/assets/tiles.bin');

    expect(res.status).toBe(401);
  });

  it('404s a name that is not a known sheet', async () => {
    session = { username: 'Alice', assetKey: '11'.repeat(32) };

    const res = await request(app).get('/assets/nonsense.bin');

    expect(res.status).toBe(404);
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
