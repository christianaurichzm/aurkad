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
      // The floor sits about 3 points under the measured baseline (70.1 lines,
      // 68.6 statements, 62.1 functions, 63.2 branches), so CI catches a drop
      // without flaking on normal variance, such as a DB test file lost to a
      // mongod that failed to start. Raise it as coverage improves; the client
      // content editors and tools/replay.ts are the largest gaps.
      thresholds: {
        lines: 67,
        statements: 65,
        functions: 59,
        branches: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
