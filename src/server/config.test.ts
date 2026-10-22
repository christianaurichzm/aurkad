import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// config.ts evaluates its guards at module load, so each case re-imports it
// with a fresh module registry and a restored env.
const ENV_KEYS = ['WS_PUBLIC_URL', 'MAP_IDS'] as const;

describe('config multi-instance mode', () => {
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

  // The presence lease keeps two instances off one account; what is left is
  // talking, which degrades rather than corrupts, so it is warned, not refused.
  it('boots when both are set, and names what does not cross instances', async () => {
    process.env.WS_PUBLIC_URL = 'ws://localhost:8080';
    process.env.MAP_IDS = '1,2';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { config } = await import('./config.js');

    expect(config.instance.mapIds).toEqual(['1', '2']);
    // The name of the test is the assertion: what is named has to be what is
    // still missing, so the warning cannot outlive the gap it describes.
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/module state \(party, guild, trade\)/),
    );
    warn.mockRestore();
  });

  it('sends warps to /ws when WS_PUBLIC_URL names only the host', async () => {
    process.env.WS_PUBLIC_URL = 'ws://host:8080';
    const { config } = await import('./config.js');
    expect(config.instance.wsPublicUrl).toBe('ws://host:8080/ws');
  });

  it('keeps a WS_PUBLIC_URL that names its own path', async () => {
    process.env.WS_PUBLIC_URL = 'wss://host/game2/ws';
    const { config } = await import('./config.js');
    expect(config.instance.wsPublicUrl).toBe('wss://host/game2/ws');
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

describe('OTEL_EXPORTER_OTLP_ENDPOINT', () => {
  const KEYS = ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_TRACES_SAMPLE_PERCENT'];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const load = async () => (await import('./config.js')).config.tracing;

  it('is off, and sampling is whole, with nothing set', async () => {
    const tracing = await load();

    expect(tracing.endpoint).toBeUndefined();
    expect(tracing.samplePercent).toBe(100);
  });

  // The OTLP convention is a base address plus the signal's own path; a
  // collector's docs give one form or the other, and both have to work.
  it('appends the traces path to a base address, once', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    expect((await load()).endpoint).toBe('http://collector:4318/v1/traces');

    vi.resetModules();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318/v1/traces';
    expect((await load()).endpoint).toBe('http://collector:4318/v1/traces');

    vi.resetModules();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318/otlp/';
    expect((await load()).endpoint).toBe(
      'http://collector:4318/otlp/v1/traces',
    );
  });

  it('refuses to boot on something that is not a usable URL', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'collector 4318';
    await expect(import('./config.js')).rejects.toThrow(/must be a URL/);

    // A host:port with no scheme parses as a scheme, which is the mistake
    // worth naming precisely: it is refused for what it actually is.
    vi.resetModules();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'collector:4318';
    await expect(import('./config.js')).rejects.toThrow(/http or https/);

    vi.resetModules();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'grpc://collector:4317';
    await expect(import('./config.js')).rejects.toThrow(/http or https/);
  });

  it('clamps the sampler to a percentage', async () => {
    process.env.OTEL_TRACES_SAMPLE_PERCENT = '250';
    expect((await load()).samplePercent).toBe(100);

    vi.resetModules();
    process.env.OTEL_TRACES_SAMPLE_PERCENT = '-5';
    expect((await load()).samplePercent).toBe(0);
  });
});

describe('GAME_DIR', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GAME_DIR;
  });

  it('resolves the game files against the working directory when unset', async () => {
    const { gamePath } = await import('./config.js');
    expect(gamePath('theme')).toBe(path.resolve('theme'));
  });

  it('resolves them against the game folder when set', async () => {
    process.env.GAME_DIR = os.tmpdir();
    const { gamePath } = await import('./config.js');
    expect(gamePath('theme')).toBe(path.join(os.tmpdir(), 'theme'));
  });

  it('refuses to boot on a folder that is not there', async () => {
    process.env.GAME_DIR = 'no-such-game';
    await expect(import('./config.js')).rejects.toThrow(/not a folder/);
  });

  it('keeps each game folder in a database of its own', async () => {
    const { mongoDbName } = await import('./config.js');
    const uri = 'mongodb://mongo:27017';
    expect(mongoDbName(uri, undefined)).toBe('game');
    expect(mongoDbName(uri, '/srv/games/my-game')).toBe('my-game');
    expect(mongoDbName(`${uri}/?replicaSet=rs0`, '/srv/games/my-game')).toBe(
      'my-game',
    );
    expect(mongoDbName(uri, '/srv/games/My Game.v2')).toBe('My_Game_v2');
  });

  it('lets a database named in the URI win over the game folder', async () => {
    const { mongoDbName } = await import('./config.js');
    expect(
      mongoDbName('mongodb://a:1,b:2/live?replicaSet=rs0', '/srv/games/x'),
    ).toBe('live');
    expect(mongoDbName('mongodb+srv://u:p@c.example.net/live', '/x')).toBe(
      'live',
    );
  });

  it('keeps each game folder in a replay folder of its own', async () => {
    delete process.env.REPLAY_DIR;
    process.env.GAME_DIR = os.tmpdir();
    const { config } = await import('./config.js');
    expect(config.replay.dir).toBe(path.join('replays', config.mongoDbName));
  });
});
