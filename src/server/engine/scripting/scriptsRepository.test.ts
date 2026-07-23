import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// mkdtemp runs inside the factory, not as a hoisted outer const: vi.mock
// factories run before any top-level binding here is initialized, so only
// what the factory imports dynamically is safe to use.
vi.mock('./loader.js', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-repo-test-'));
  return {
    SCRIPTS_DIR: dir,
    isScriptFile: (f: string) =>
      !f.endsWith('.d.ts') && (f.endsWith('.js') || f.endsWith('.ts')),
  };
});

import { SCRIPTS_DIR } from './loader.js';
import {
  isValidScriptName,
  listScriptFiles,
  readScriptFile,
  writeScriptFile,
  createScriptFile,
  deleteScriptFile,
  readTypeDefs,
} from './scriptsRepository.js';

beforeEach(() => {
  for (const f of fs.readdirSync(SCRIPTS_DIR)) {
    fs.unlinkSync(path.join(SCRIPTS_DIR, f));
  }
});

afterEach(() => {
  for (const f of fs.readdirSync(SCRIPTS_DIR)) {
    fs.unlinkSync(path.join(SCRIPTS_DIR, f));
  }
});

describe('isValidScriptName', () => {
  it('accepts plain .js/.ts basenames', () => {
    expect(isValidScriptName('example.js')).toBe(true);
    expect(isValidScriptName('vip-system.ts')).toBe(true);
    expect(isValidScriptName('quest_2.js')).toBe(true);
  });

  it('rejects path traversal and non-basenames', () => {
    expect(isValidScriptName('../secret.js')).toBe(false);
    expect(isValidScriptName('/etc/passwd')).toBe(false);
    expect(isValidScriptName('sub/dir.js')).toBe(false);
    expect(isValidScriptName('..\\..\\win.js')).toBe(false);
  });

  it('rejects disallowed extensions and empty names', () => {
    expect(isValidScriptName('malware.exe')).toBe(false);
    expect(isValidScriptName('global.d.ts')).toBe(false);
    expect(isValidScriptName('')).toBe(false);
    expect(isValidScriptName('noext')).toBe(false);
  });
});

describe('script file CRUD', () => {
  it('round-trips write/read/delete', () => {
    expect(writeScriptFile('a.js', 'console.log(1);')).toBe(true);
    expect(readScriptFile('a.js')).toBe('console.log(1);');
    expect(deleteScriptFile('a.js')).toBe(true);
    expect(readScriptFile('a.js')).toBeNull();
  });

  it('rejects writes/reads/deletes with an invalid name', () => {
    expect(writeScriptFile('../x.js', 'bad')).toBe(false);
    expect(readScriptFile('../x.js')).toBeNull();
    expect(deleteScriptFile('../x.js')).toBe(false);
  });

  it('creates a new file but refuses to overwrite an existing one', () => {
    expect(createScriptFile('b.js', 'a')).toBe('created');
    expect(createScriptFile('b.js', 'b')).toBe('exists');
    expect(readScriptFile('b.js')).toBe('a');
  });

  it('lists script files sorted, excluding .d.ts', () => {
    writeScriptFile('z.js', '');
    writeScriptFile('a.ts', '');
    fs.writeFileSync(path.join(SCRIPTS_DIR, 'content.generated.d.ts'), '');

    const names = listScriptFiles().map((f) => f.name);
    expect(names).toEqual(['a.ts', 'z.js']);
  });
});

describe('readTypeDefs', () => {
  it('returns empty strings when the files are missing', () => {
    expect(readTypeDefs()).toEqual({ globalDts: '', contentDts: '' });
  });

  it('reads both type definition files when present', () => {
    fs.writeFileSync(
      path.join(SCRIPTS_DIR, 'global.d.ts'),
      'declare const x: 1;',
    );
    fs.writeFileSync(
      path.join(SCRIPTS_DIR, 'content.generated.d.ts'),
      'declare const Items: {};',
    );
    expect(readTypeDefs()).toEqual({
      globalDts: 'declare const x: 1;',
      contentDts: 'declare const Items: {};',
    });
  });
});
