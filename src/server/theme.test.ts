import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readTheme,
  removeThemeImage,
  saveThemeImage,
  themeVariables,
  writeTheme,
} from './theme.js';

let dir: string;
const file = () => path.join(dir, 'theme.json');
const write = (value: unknown) =>
  fs.writeFileSync(file(), JSON.stringify(value));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-json-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('themeVariables', () => {
  it('writes nothing for a game that picks nothing, so the engine keeps its own values', async () => {
    expect(themeVariables(await readTheme(dir))).toBe('');
  });

  it('writes a picked colour, and mixes only the tokens that follow from it', async () => {
    write({ colors: { primary: '#d9822b' } });

    const css = themeVariables(await readTheme(dir));

    expect(css).toContain('--color-primary: #d9822b;');
    expect(css).toContain('--color-primary-hover: color-mix(');
    expect(css).toContain('--color-selected: color-mix(');
    expect(css).not.toContain('--color-border');
    expect(css).not.toContain('--color-danger');
  });

  it('gives a picked surface the border and the muted surface that go with it', async () => {
    write({ colors: { surface: '#2a211a' } });

    const css = themeVariables(await readTheme(dir));

    expect(css).toContain('--color-surface: #2a211a;');
    expect(css).toContain('--color-border: color-mix(');
    expect(css).toContain('--color-surface-muted: color-mix(');
  });

  it('sets both radii from a corner style, and the text font from a font', async () => {
    write({ corners: 'soft', font: 'serif' });

    const css = themeVariables(await readTheme(dir));

    expect(css).toContain('--radius-control: 4px;');
    expect(css).toContain('--radius-panel: 6px;');
    expect(css).toContain('--font-ui: Georgia');
  });

  it('leaves the world lit behind a conversation when the game asks', async () => {
    write({ dialogDim: false });

    expect(themeVariables(await readTheme(dir))).toContain(
      '--dialog-dim: transparent;',
    );
  });
});

describe('readTheme', () => {
  it('defaults to the menu on the right, over pixel art', async () => {
    expect(await readTheme(dir)).toMatchObject({
      layout: 'right',
      art: 'pixel',
    });
  });

  it('takes a world that fills the window, drawn smooth', async () => {
    write({ layout: 'overlay', art: 'smooth' });

    expect(await readTheme(dir)).toMatchObject({
      layout: 'overlay',
      art: 'smooth',
    });
  });

  it.each([
    ['a colour that is not a hex', { colors: { primary: 'red' } }],
    ['CSS where a colour goes', { colors: { primary: '#fff; } body { x: y' } }],
    ['a name it does not know', { corner: 'soft' }],
    ['a layout it does not have', { layout: 'top' }],
    ['art it does not know', { art: 'vector' }],
    ['a picture no upload named', { logo: '../game.json' }],
  ])('ignores the whole file for %s', async (_, value) => {
    write({ ...value, layout: 'layout' in value ? value.layout : 'bottom' });

    const theme = await readTheme(dir);

    expect(theme.layout).toBe('right');
    expect(themeVariables(theme)).toBe('');
  });

  it('ignores a file that is not JSON', async () => {
    fs.writeFileSync(file(), '{ not json');

    expect((await readTheme(dir)).layout).toBe('right');
  });

  it('reads the file again when it changes, not before', async () => {
    write({ layout: 'left' });
    expect((await readTheme(dir)).layout).toBe('left');

    write({ layout: 'bottom' });
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file(), later, later);

    expect((await readTheme(dir)).layout).toBe('bottom');
  });
});

// The least a decoder would call a PNG: the signature is what is checked.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 2]);

describe('writeTheme', () => {
  it('is read back at once, in a folder that was not there', async () => {
    const nested = path.join(dir, 'theme');

    await writeTheme(nested, {
      colors: {},
      layout: 'left',
      art: 'pixel',
      dialogDim: true,
    });
    expect((await readTheme(nested)).layout).toBe('left');

    await writeTheme(nested, {
      colors: {},
      layout: 'bottom',
      art: 'pixel',
      dialogDim: true,
    });
    expect((await readTheme(nested)).layout).toBe('bottom');
  });

  it('keeps the pictures, which it is not told about', async () => {
    const { logo } = (await saveThemeImage(dir, 'logo', PNG))!;

    await writeTheme(dir, {
      colors: {},
      layout: 'left',
      art: 'pixel',
      dialogDim: false,
    });

    expect(await readTheme(dir)).toMatchObject({ logo, layout: 'left' });
  });
});

describe('saveThemeImage', () => {
  it('keeps both of two changes made at the same time', async () => {
    const [, , saved] = await Promise.all([
      saveThemeImage(dir, 'logo', PNG),
      writeTheme(dir, {
        colors: {},
        layout: 'left',
        art: 'pixel',
        dialogDim: false,
      }),
      saveThemeImage(dir, 'background', JPEG),
    ]);

    expect(await readTheme(dir)).toMatchObject({
      logo: expect.stringMatching(/^logo-/),
      background: saved!.background,
      layout: 'left',
    });
  });

  it('names the file by what it is, not by what the upload said', async () => {
    const theme = await saveThemeImage(dir, 'background', JPEG);

    expect(theme?.background).toMatch(/^background-[0-9a-f]{8}\.jpg$/);
    expect(fs.readFileSync(path.join(dir, theme!.background!))).toEqual(JPEG);
    expect(themeVariables(theme!)).toContain(
      `url('/theme/${theme!.background}') center / cover`,
    );
  });

  it('replaces the last upload and leaves a file put there by hand', async () => {
    fs.writeFileSync(path.join(dir, 'logo.png'), PNG);
    const first = (await saveThemeImage(dir, 'logo', PNG))!.logo!;

    const second = (await saveThemeImage(dir, 'logo', JPEG))!.logo!;

    expect(fs.readdirSync(dir).sort()).toEqual(
      ['logo.png', second, 'theme.json'].sort(),
    );
    expect(second).not.toBe(first);
  });

  it('writes nothing for bytes that are not a picture', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

    expect(await saveThemeImage(dir, 'logo', svg)).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('removeThemeImage', () => {
  it('takes the file and the mention of it away', async () => {
    await saveThemeImage(dir, 'logo', PNG);

    const theme = await removeThemeImage(dir, 'logo');

    expect(theme.logo).toBeUndefined();
    expect((await readTheme(dir)).logo).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual(['theme.json']);
  });
});
