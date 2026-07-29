import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules/**', 'dist/**'],
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
      // Ratchet floor sits just under the measured baseline (2026-07-28:
      // 63.7 lines / 61.9 statements / 54.7 functions / 52.9 branches) so CI
      // catches regressions without flaking on normal variance. Raise it as
      // coverage improves; the client content editors are the main gap.
      thresholds: {
        lines: 60,
        statements: 58,
        functions: 51,
        branches: 49,
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
