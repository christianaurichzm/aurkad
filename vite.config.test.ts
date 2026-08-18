import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Every server path the client calls has to be in the dev proxy allowlist.
 * A missing entry shows no symptom: Vite answers with its own index.html
 * and a 200, so the call "succeeds" and the feature stays dead until a
 * production build, which is why this is checked rather than remembered.
 */

const ROOT = path.resolve(__dirname);
const CLIENT_DIR = path.join(ROOT, 'src/client');

// Read rather than imported: importing the config drags Vite's plugins,
// and esbuild with them, into a jsdom worker that cannot host them.
const PROXY_RULE = /^\s*"([^"]+)":\s*\{\s*target:/gm;

// Paths as they are written at the call: `httpClient('/x')`, `fetch('/x')`,
// and the audio element that loads a file straight off the server.
const CALL = /(?:httpClient(?:<[^>]*>)?|fetch|new Audio)\(\s*[`']([^`'$]*)/g;

function clientPaths(dir: string, found = new Set<string>()): Set<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      clientPaths(full, found);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      for (const [, called] of fs.readFileSync(full, 'utf8').matchAll(CALL)) {
        if (called?.startsWith('/')) found.add(called);
      }
    }
  }
  return found;
}

describe('the dev proxy', () => {
  it('carries every path the client asks the server for', () => {
    const viteConfig = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
    const rules = [...viteConfig.matchAll(PROXY_RULE)].map(([, rule]) => rule!);
    expect(rules.length).toBeGreaterThan(10);

    const missing = [...clientPaths(CLIENT_DIR)].filter(
      (called) =>
        !rules.some((rule) =>
          rule.startsWith('^')
            ? new RegExp(rule).test(called)
            : called.startsWith(rule),
        ),
    );

    expect(missing).toEqual([]);
  });
});
