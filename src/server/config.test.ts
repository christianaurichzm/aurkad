import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// config.ts evaluates its guards at module load, so each case re-imports it
// with a fresh module registry and a restored env.
const ENV_KEYS = [
  'WS_PUBLIC_URL',
  'MAP_IDS',
  'ALLOW_UNSAFE_MULTI_INSTANCE',
] as const;

describe('config multi-instance guard', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('boots when neither multi-instance variable is set', async () => {
    await expect(import('./config.js')).resolves.toBeDefined();
  });

  it('boots when only WS_PUBLIC_URL is set', async () => {
    process.env.WS_PUBLIC_URL = 'ws://localhost:8080';
    await expect(import('./config.js')).resolves.toBeDefined();
  });

  it('boots when only MAP_IDS is set', async () => {
    process.env.MAP_IDS = '1,2';
    await expect(import('./config.js')).resolves.toBeDefined();
  });

  it('refuses to boot when both are set, since presence is per-process', async () => {
    process.env.WS_PUBLIC_URL = 'ws://localhost:8080';
    process.env.MAP_IDS = '1,2';
    await expect(import('./config.js')).rejects.toThrow(
      /Multi-instance mode .* is disabled/,
    );
  });

  it('boots when the operator opts in explicitly', async () => {
    process.env.WS_PUBLIC_URL = 'ws://localhost:8080';
    process.env.MAP_IDS = '1,2';
    process.env.ALLOW_UNSAFE_MULTI_INSTANCE = 'true';
    const { config } = await import('./config.js');
    expect(config.instance.mapIds).toEqual(['1', '2']);
  });

  it('only accepts the exact opt-in value', async () => {
    process.env.WS_PUBLIC_URL = 'ws://localhost:8080';
    process.env.MAP_IDS = '1,2';
    process.env.ALLOW_UNSAFE_MULTI_INSTANCE = '1';
    await expect(import('./config.js')).rejects.toThrow(
      /Multi-instance mode .* is disabled/,
    );
  });

  it('ignores an empty MAP_IDS, which parses to undefined', async () => {
    process.env.WS_PUBLIC_URL = 'ws://localhost:8080';
    process.env.MAP_IDS = '  ,  ';
    await expect(import('./config.js')).resolves.toBeDefined();
  });
});
