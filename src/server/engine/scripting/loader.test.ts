/**
 * The check that stands in for compiling a script. Files go to a temp
 * directory rather than `scripts/`, so the repo's own scripts can change
 * without moving these.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkScriptTypes, initTsSupport } from './loader.js';
import { clearScriptErrors, getScriptErrors } from './scriptErrors.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurkad-scripts-'));

function write(name: string, code: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, code);
  return file;
}

beforeEach(async () => {
  clearScriptErrors();
  await initTsSupport();
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('checkScriptTypes', () => {
  it('reports a call to an api function that does not exist', () => {
    const file = write('typo.js', 'giveItm(1);\n');

    checkScriptTypes([file]);

    const [error] = getScriptErrors('typo.js');
    expect(error?.source).toBe('typecheck');
    expect(error?.message).toContain('giveItm');
    expect(error?.line).toBe(1);
  });

  // Also the proof that global.d.ts reached the program at all: without it
  // every line below is an unknown name and this test fails loudly.
  it('says nothing about a script that uses the real api', () => {
    const file = write(
      'fine.js',
      'if (random() > 0.5) log("hello");\nconst n = randomInt(3);\nlog(n);\n',
    );

    checkScriptTypes([file]);

    expect(getScriptErrors('fine.js')).toEqual([]);
  });

  // Each script runs in its own vm context, so the same top-level name in two
  // files is legal. Checking them in one program would call it a redeclaration.
  it('lets two scripts declare the same top-level name', () => {
    const a = write('one.js', 'const helper = () => log("a");\nhelper();\n');
    const b = write('two.js', 'const helper = () => log("b");\nhelper();\n');

    checkScriptTypes([a, b]);

    expect(getScriptErrors('one.js')).toEqual([]);
    expect(getScriptErrors('two.js')).toEqual([]);
  });
});
