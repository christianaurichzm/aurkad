import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// public/styles.css promises a game's theme.css a short list of ids and
// classes (its header comment). A theme targeting one that the client stopped
// rendering fails silently, with the game just looking wrong, so the list is
// checked here against the source the markup is built from.

const root = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf-8');
const contract =
  /Theme contract:([\s\S]*?)\*\//
    .exec(css)?.[1]
    ?.match(/[#.][A-Za-z][\w-]*/g) ?? [];

const clientDir = path.join(root, 'src/client');
const source = [
  fs.readFileSync(path.join(root, 'index.html'), 'utf-8'),
  ...fs
    .readdirSync(clientDir, { recursive: true, encoding: 'utf-8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => fs.readFileSync(path.join(clientDir, file), 'utf-8')),
].join('\n');

// An id is assigned (`id="hud"`, `el.id = 'hud'`); a class is a whole word in
// a string, since class names are often built (`floating ? 'a b' : 'a'`).
// Names are [\w-] only, so they go into the patterns unescaped.
const rendered = (selector: string) => {
  const name = selector.slice(1);
  return selector.startsWith('#')
    ? new RegExp(`\\bid\\s*[=:]\\s*["'\`]${name}["'\`]`).test(source)
    : new RegExp(
        `["'\`](?:[^"'\`\\n]*\\s)?${name}(?:\\s[^"'\`\\n]*)?["'\`]`,
      ).test(source);
};

describe('the theme contract in styles.css', () => {
  it('is read from the header comment', () => {
    expect(contract).toContain('#hud');
    expect(contract).toContain('.module-panel');
  });

  it.each(contract)('%s is still rendered by the client', (selector) => {
    expect(rendered(selector)).toBe(true);
  });
});
