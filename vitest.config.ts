import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/*.spec.ts runs under Playwright's own runner (npm run e2e) against a
    // real browser and server; Vitest's default glob would pick it up and fail
    // at once on @playwright/test's incompatible `test`/`expect`.
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    // Slow userEvent-driven UI tests can exceed the 5s default under parallel
    // load (many test files + the in-memory Mongo integration suites).
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/',
      ],
      // Ratchet floor sits ~3 points under the measured baseline (2026-08-08:
      // 69.1 lines / 67.7 statements / 60.9 functions / 62.4 branches) so CI
      // catches regressions without flaking on normal variance. The margin is
      // not decoration: mongodb-memory-server occasionally fails to start and
      // takes a whole DB test file with it, which is worth a couple of points.
      // Raise it as coverage improves; the client content editors are the main
      // gap, and tools/replay.ts is the largest single one outside them.
      thresholds: {
        lines: 66,
        statements: 64,
        functions: 57,
        branches: 59,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // monaco-editor ships no "main"/CJS entry (browser-only ESM package),
      // which breaks Node-style resolution under Vitest even when the module
      // is fully vi.mock'd. Pointing it at a real file on disk lets resolution
      // succeed; vi.mock still replaces its content.
      'monaco-editor': path.resolve(
        __dirname,
        'node_modules/monaco-editor/esm/vs/editor/editor.api.js',
      ),
    },
  },
});
