import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// e2e/*.spec.ts runs under Playwright's own runner (npm run e2e) against a
// real browser and server; Vitest's default glob would pick it up and fail
// at once on @playwright/test's incompatible `test`/`expect`. Worktrees
// under a dot-directory hold checkouts of other branches, whose copies of
// every test would otherwise run here too.
const exclude = ['node_modules/**', 'dist/**', 'e2e/**', '.*/**'];

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    exclude,
    // Slow userEvent-driven UI tests can exceed the 5s default under parallel
    // load (many test files + the in-memory Mongo integration suites).
    testTimeout: 15000,
    // A jsdom window is most of what a test file costs to start, and only the
    // client renders anything, so the server, shared code, tools and bench run
    // under plain node.
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          include: ['src/client/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          include: ['**/*.test.{ts,tsx}'],
          exclude: [...exclude, 'src/client/**'],
          environment: 'node',
        },
      },
    ],
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
});
