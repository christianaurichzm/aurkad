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

const appFor = (
  brand: { name: string; logo?: string },
  {
    levels = true,
    attributes = levels,
    inventory = true,
  }: { levels?: boolean; attributes?: boolean; inventory?: boolean } = {},
) =>
  express().use(
    createGameRouter({ brand, levels, attributes, inventory, themeDir }),
  );

describe('gameRoutes', () => {
  it('names the game and points at its logo in theme/', async () => {
    const res = await request(appFor({ name: 'Tandem', logo: 'logo.png' })).get(
      '/game',
    );

    expect(res.body).toEqual({
      name: 'Tandem',
      logo: '/theme/logo.png',
      levels: true,
      attributes: true,
      inventory: true,
      account: expect.any(Object),
      layout: 'right',
      art: 'pixel',
    });
  });

  it("hands the sign-up form the game's account rules", async () => {
    const account = {
      usernameMinLength: 4,
      usernameMaxLength: 12,
      usernamePattern: '^(?:[a-z]+)$',
      passwordMinLength: 10,
    };
    const app = express().use(
      createGameRouter({ brand: { name: 'Tandem' }, account, themeDir }),
    );

    expect((await request(app).get('/game')).body.account).toEqual(account);
  });

  it('says where the menu sits, once theme.json says', async () => {
    fs.writeFileSync(
      path.join(themeDir, 'theme.json'),
      JSON.stringify({ layout: 'overlay', art: 'smooth' }),
    );

    const res = await request(appFor({ name: 'Tandem' })).get('/game');

    expect(res.body).toMatchObject({ layout: 'overlay', art: 'smooth' });
  });

  it('shows a logo uploaded from the Appearance page over the one game.json names', async () => {
    fs.writeFileSync(
      path.join(themeDir, 'theme.json'),
      JSON.stringify({ logo: 'logo-0123abcd.webp' }),
    );

    const res = await request(appFor({ name: 'Tandem', logo: 'logo.png' })).get(
      '/game',
    );

    expect(res.body.logo).toBe('/theme/logo-0123abcd.webp');
  });

  it('says so when the game has no attribute points to hand out', async () => {
    const res = await request(
      appFor({ name: 'Tandem' }, { attributes: false }),
    ).get('/game');

    expect(res.body).toMatchObject({ levels: true, attributes: false });
  });

  it('says so when the game has no bag', async () => {
    const res = await request(
      appFor({ name: 'Tandem' }, { inventory: false }),
    ).get('/game');

    expect(res.body).toMatchObject({ inventory: false });
  });

  it('says so when the game has no levels at all', async () => {
    const res = await request(
      appFor({ name: 'Tandem' }, { levels: false }),
    ).get('/game');

    expect(res.body).toMatchObject({ levels: false, attributes: false });
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

  it('puts what theme.json asks for ahead of the theme written by hand', async () => {
    fs.writeFileSync(
      path.join(themeDir, 'theme.json'),
      JSON.stringify({ colors: { primary: '#d9822b' } }),
    );
    fs.writeFileSync(path.join(themeDir, 'theme.css'), '.a{color:red}');

    const res = await request(appFor({ name: 'Tandem' })).get(
      '/theme/theme.css',
    );

    expect(res.text).toMatch(/^:root \{\n {2}--color-primary: #d9822b;/);
    expect(res.text.endsWith('.a{color:red}')).toBe(true);
  });
});
