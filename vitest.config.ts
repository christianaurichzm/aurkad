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
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/',
      ],
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
