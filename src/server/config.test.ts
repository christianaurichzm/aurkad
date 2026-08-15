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

  it('boots when the operator opts in explicitly, and warns every boot', async () => {
    process.env.WS_PUBLIC_URL = 'ws://localhost:8080';
    process.env.MAP_IDS = '1,2';
    process.env.ALLOW_UNSAFE_MULTI_INSTANCE = 'true';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { config } = await import('./config.js');
    expect(config.instance.mapIds).toEqual(['1', '2']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ALLOW_UNSAFE_MULTI_INSTANCE=true'),
    );
    warn.mockRestore();
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

// Express reads several shapes here, and they differ in who gets rate
// limited: the value decides req.ip for a caller without a session.
describe('TRUST_PROXY', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
    vi.restoreAllMocks();
  });

  it('trusts nothing by default', async () => {
    const { config } = await import('./config.js');
    expect(config.http.trustProxy).toBe(false);
  });

  it('reads a hop count as a number, which is the form to use', async () => {
    process.env.TRUST_PROXY = '1';
    const { config } = await import('./config.js');
    expect(config.http.trustProxy).toBe(1);
  });

  it('passes an address list through for Express to parse', async () => {
    process.env.TRUST_PROXY = '10.0.0.1, 10.0.0.2';
    const { config } = await import('./config.js');
    expect(config.http.trustProxy).toBe('10.0.0.1, 10.0.0.2');
  });

  // Accepted, because an operator may genuinely mean it, but never silently:
  // it means any caller can hand themselves a fresh rate-limit key.
  it('warns when told to trust any X-Forwarded-For', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.TRUST_PROXY = 'true';

    const { config } = await import('./config.js');

    expect(config.http.trustProxy).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('choose their own rate-limit key'),
    );
  });
});
