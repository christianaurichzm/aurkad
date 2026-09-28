import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createGameRouter } from './gameRoutes.js';

let themeDir: string;

beforeEach(() => {
  themeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-'));
});

afterEach(() => {
  fs.rmSync(themeDir, { recursive: true, force: true });
});

const appFor = (brand: { name: string; logo?: string }) =>
  express().use(createGameRouter({ brand, themeDir }));

describe('gameRoutes', () => {
  it('names the game and points at its logo in theme/', async () => {
    const res = await request(appFor({ name: 'Tandem', logo: 'logo.png' })).get(
      '/game',
    );

    expect(res.body).toEqual({ name: 'Tandem', logo: '/theme/logo.png' });
  });

  it('falls back to the engine icon for a game with no logo', async () => {
    const res = await request(appFor({ name: 'Aurkad' })).get('/game');

    expect(res.body.logo).toBe('/favicon.svg');
  });

  it('serves the theme and the pictures beside it, with no session', async () => {
    fs.writeFileSync(path.join(themeDir, 'theme.css'), ':root{--x:1}');
    fs.writeFileSync(path.join(themeDir, 'logo.png'), 'png');
    const app = appFor({ name: 'Tandem' });

    const css = await request(app).get('/theme/theme.css');
    expect(css.status).toBe(200);
    expect(css.text).toBe(':root{--x:1}');
    expect((await request(app).get('/theme/logo.png')).status).toBe(200);
  });

  it('answers an empty stylesheet for a game that has no theme', async () => {
    const res = await request(appFor({ name: 'Aurkad' })).get(
      '/theme/theme.css',
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
    expect(res.text).toBe('');
  });
});
