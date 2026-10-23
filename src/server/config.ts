import fs from 'node:fs';
import path from 'node:path';
import type { CorsOptions } from 'cors';
import { TICK_RATE } from '../shared/constants.js';

export type NodeEnv = 'development' | 'production' | 'test';

function resolveNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value;
  }
  return 'development';
}

const nodeEnv: NodeEnv = resolveNodeEnv(process.env.NODE_ENV);

// A variable already in the environment wins over the file. No file is the
// normal case for a deployment that sets them some other way.
try {
  process.loadEnvFile(
    nodeEnv === 'production' ? './.env.production' : './.env.development',
  );
} catch {
  // Nothing to load.
}

function parseIntEnv(
  key: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  // Out-of-range values clamp to the nearest bound rather than the default:
  // MAX_UPDATES_PER_TICK=200 means the 20 ceiling, not 2.
  if (opts.min !== undefined && value < opts.min) return opts.min;
  if (opts.max !== undefined && value > opts.max) return opts.max;
  return value;
}

/**
 * `TRUST_PROXY` as Express reads it. Digits are a hop count (`1` behind one
 * nginx); presets and address lists pass through as strings. `true` is
 * accepted with a warning: it believes any X-Forwarded-For, so a caller picks
 * its own rate-limit key.
 */
function parseTrustProxy(): boolean | number | string {
  const raw = process.env['TRUST_PROXY']?.trim();
  if (!raw || raw === 'false') return false;

  if (raw === 'true') {
    console.warn(
      '[config] TRUST_PROXY=true trusts any X-Forwarded-For, so a caller can ' +
        'choose their own rate-limit key. Prefer the number of proxies in ' +
        'front of the server (e.g. TRUST_PROXY=1).',
    );
    return true;
  }

  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
}

function parseCsvEnv(key: string): string[] | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const corsAllowedOrigins = parseCsvEnv('CORS_ALLOWED_ORIGINS') ?? ['*'];

// The session cookie is the whole login, and without Secure a browser also
// sends it over plain http. Opt-in by variable rather than from NODE_ENV,
// since only the operator knows whether a TLS proxy is in front.
if (nodeEnv === 'production' && process.env.USE_SECURE_COOKIES !== 'true') {
  throw new Error(
    '[config] USE_SECURE_COOKIES must be "true" in production, so the session ' +
      'cookie is only ever sent over HTTPS. Serving without TLS is not a ' +
      'supported deployment.',
  );
}

if (nodeEnv === 'production' && !process.env.CORS_ALLOWED_ORIGINS) {
  throw new Error(
    '[config] CORS_ALLOWED_ORIGINS must be set in production. ' +
      'Use a comma-separated list of allowed origins, e.g. https://yourgame.com',
  );
}

// Mail: a transport that cannot send is worse than the log one, because the
// login screen offers "forgot password" on the strength of `smtp` being set
// and every request after that dies quietly inside a promise. Both values are
// the operator's and neither has a sane default, so the boot asks for them.
const mailTransport =
  process.env.MAIL_TRANSPORT === 'smtp'
    ? 'smtp'
    : process.env.MAIL_TRANSPORT === 'none'
      ? 'none'
      : 'log';

if (
  mailTransport === 'smtp' &&
  (!process.env.SMTP_URL || !process.env.MAIL_FROM)
) {
  throw new Error(
    '[config] MAIL_TRANSPORT=smtp needs SMTP_URL (e.g. smtps://user:pass@smtp.example.com) ' +
      'and MAIL_FROM (the address players will see it from).',
  );
}

// A short token is worse than none: it reads as protection while being
// guessable, and this endpoint is a capacity map of the server. Fail at boot
// rather than serve it.
const metricsToken = process.env.METRICS_TOKEN?.trim() || undefined;
if (metricsToken !== undefined && metricsToken.length < 16) {
  throw new Error(
    '[config] METRICS_TOKEN must be at least 16 characters. Use a secure random string (e.g. openssl rand -hex 32).',
  );
}

/**
 * Where finished spans are posted, or nothing. A base address
 * (`http://collector:4318`) gets the signal's path appended, and a full URL
 * from a vendor's docs works too. A value that is not a URL fails the boot,
 * or telemetry would go nowhere unnoticed.
 */
function parseTracingEndpoint(): string | undefined {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      '[config] OTEL_EXPORTER_OTLP_ENDPOINT must be a URL, e.g. http://localhost:4318',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `[config] OTEL_EXPORTER_OTLP_ENDPOINT must be http or https, not ${url.protocol}`,
    );
  }
  const path = url.pathname.replace(/\/+$/, '');
  return path.endsWith('/v1/traces')
    ? url.toString()
    : `${url.origin}${path}/v1/traces`;
}

const tracingEndpoint = parseTracingEndpoint();

// Warps send the client to this URL and the server upgrades only /ws, so a
// bare host (ws://host:8080) means its /ws. A path is kept as given, for a
// proxy that serves the game under one.
function parseWsPublicUrl(): string | undefined {
  const raw = process.env.WS_PUBLIC_URL;
  const url = raw ? URL.parse(raw) : null;
  if (!url || url.pathname !== '/') return raw;
  url.pathname = '/ws';
  return url.toString();
}

// An all-blank MAP_IDS parses to [], which would read as sharding. It means
// "own all maps", like unset, so both become undefined here.
const rawMapIds = parseCsvEnv('MAP_IDS');
const mapIds = rawMapIds?.length ? rawMapIds : undefined;

// Multi-instance mode boots: the presence lease (persistence/presence.ts)
// keeps two instances off one account, and the instance bus carries what an
// operator says. Module state is still per process, so a party or trade
// forms only on one instance; that degrades in the open, so it is a warning.
if (process.env.WS_PUBLIC_URL && mapIds) {
  console.warn(
    '[config] Multi-instance mode: accounts, operator announcements, moderation and the ' +
      'commands that act on one character (pm, heal, kill, tp) cross instances; module ' +
      'state (party, guild, trade) still only reaches the instance the player is on.',
  );
}

const dbName = mongoDbName(process.env.MONGO_URI ?? '');

export const config = {
  nodeEnv,
  port: parseIntEnv('PORT', 8080, { min: 1, max: 65535 }),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017',
  mongoDbName: dbName,
  session: {
    // Unset, storedSessionSecret keeps one in the database to sign with.
    secret: process.env.SESSION_SECRET || undefined,
  },
  limits: {
    actionQueueMaxSize: parseIntEnv('ACTION_QUEUE_MAX_SIZE', 5000, {
      min: 100,
      max: 100_000,
    }),
    eventQueueMaxSize: parseIntEnv('EVENT_QUEUE_MAX_SIZE', 5000, {
      min: 100,
      max: 100_000,
    }),
    wsMaxMessagesPerSecond: parseIntEnv('WS_MAX_MESSAGES_PER_SECOND', 60, {
      min: 1,
      max: 5000,
    }),
  },
  http: {
    jsonBodyLimit: '1mb',
    // What Express believes about X-Forwarded-For, which keys every rate limit
    // for callers with no session. Off by default, since with nobody in front
    // the header is the caller's to write. Behind a proxy it must be set, or
    // all clients share the proxy's address (http/middleware/rateLimit.ts).
    trustProxy: parseTrustProxy(),
    // Ceiling for everything that is not a login: generous enough that a
    // player loading a map and its assets never notices, low enough that a
    // script hammering an endpoint is capped. Per key, per window.
    rateLimitWindowMs: parseIntEnv('HTTP_RATE_LIMIT_WINDOW_MS', 60_000, {
      min: 1_000,
      max: 60 * 60_000,
    }),
    rateLimitMax: parseIntEnv('HTTP_RATE_LIMIT_MAX', 300, {
      min: 1,
      max: 1_000_000,
    }),
  },
  metrics: {
    // Bearer token for /metrics, since a scraper cannot hold an operator
    // session. Unset, only an admin session reads it.
    token: metricsToken,
  },
  tracing: {
    // Off unless a collector is named. With it unset the ids are still minted
    // and still reach every log line; what stops is the export.
    endpoint: tracingEndpoint,
    // What the traces are labelled as. Two instances of one game share it and
    // separate themselves by `service.instance.id` (their WS_PUBLIC_URL).
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'aurkad',
    // Per cent of new traces recorded, an integer clamped like the rest here,
    // where a truncated 0.25 would record nothing.
    samplePercent: parseIntEnv('OTEL_TRACES_SAMPLE_PERCENT', 100, {
      min: 0,
      max: 100,
    }),
  },
  scriptData: {
    // Bounds on the data scripts persist (player.data and the KV store).
    // maxValueBytes x maxKeys caps one player's data; the default 8MB leaves
    // half of MongoDB's 16MB document for the rest (persistence/dataLimits.ts).
    maxValueBytes: parseIntEnv('SCRIPT_DATA_MAX_VALUE_BYTES', 64 * 1024, {
      min: 1024,
      max: 4 * 1024 * 1024,
    }),
    maxKeys: parseIntEnv('SCRIPT_DATA_MAX_KEYS', 128, {
      min: 1,
      max: 4096,
    }),
    // The KV store is one document per entry, so the byte limit above is
    // enough there; this caps how many entries live in memory at once.
    maxKvEntries: parseIntEnv('KV_MAX_ENTRIES', 100_000, {
      min: 100,
      max: 10_000_000,
    }),
  },
  mail: {
    // Where mail goes. `smtp` hands it to the relay in SMTP_URL. `log` writes
    // it to the server log, so a game with no mail account can still reset a
    // password by hand, and `none` drops it.
    transport: mailTransport,
    // One URL rather than host/port/user/pass/secure, because every relay
    // documents itself in that form and five values are five ways to get one
    // wrong. Implicit TLS on port 465 is smtps://user:pass@smtp.example.com,
    // STARTTLS on 587 is smtp://user:pass@smtp.example.com:587.
    smtpUrl: process.env.SMTP_URL?.trim() || '',
    // Relays refuse a sender they have not authorised, so this is the
    // operator's own address rather than anything the engine can invent.
    from: process.env.MAIL_FROM?.trim() || '',
    // What a link in a message points at. Only the operator knows the address
    // players type, so a wrong guess here produces a link nobody can open;
    // the fallback is the local one, which is right in development and
    // obviously wrong anywhere else.
    publicBaseUrl: (
      process.env.PUBLIC_BASE_URL ||
      `http://localhost:${parseIntEnv('PORT', 8080, { min: 1, max: 65535 })}`
    ).replace(/\/+$/, ''),
  },
  analytics: {
    // Whether player activity is recorded. On by default, or "did the update
    // kill retention" has no answer; off is valid too, as this is the one store
    // about people. Turn it off before `npm run loadtest`, or the bots count
    // as daily players.
    enabled: process.env.ANALYTICS_ENABLED !== 'false',
    // How long the per-day rows live. Long by default: retention is read in
    // cohorts, so the useful window is a year of them plus the tail of the last
    // one. It is the reporting window too.
    retentionDays: parseIntEnv('ANALYTICS_RETENTION_DAYS', 400, {
      min: 30,
      max: 3650,
    }),
  },
  economy: {
    // How often every item in the world is counted, and how long the counts
    // are kept. The job walks every player document, so it is
    // infrequent: the question it answers ("did a total move in a way loot and
    // spending cannot explain") is asked in hours, not seconds.
    censusIntervalMinutes: parseIntEnv('ECONOMY_CENSUS_INTERVAL_MINUTES', 60, {
      min: 5,
      max: 24 * 60,
    }),
    censusRetentionDays: parseIntEnv('ECONOMY_CENSUS_RETENTION_DAYS', 30, {
      min: 1,
      max: 365,
    }),
    // A total that grows by more than this multiple between two counts is
    // logged as suspicious. Loot mints items, so the floor below keeps a few
    // new potions from tripping it.
    censusAlertGrowth: parseIntEnv('ECONOMY_CENSUS_ALERT_GROWTH_PERCENT', 100, {
      min: 10,
      max: 100_000,
    }),
    censusAlertFloor: parseIntEnv('ECONOMY_CENSUS_ALERT_MIN_CHANGE', 100, {
      min: 1,
      max: 1_000_000,
    }),
  },
  replay: {
    // What a session recording may cost in memory. It is a ring: at the
    // ceiling the oldest action is dropped and counted, so recording left on
    // keeps the recent minutes. At ~150 bytes an action, the default is a few
    // MB, which a busy server fills in minutes.
    maxEvents: parseIntEnv('REPLAY_MAX_EVENTS', 50_000, {
      min: 100,
      max: 5_000_000,
    }),
    // Recordings are player data, so they stay out of the game folder, which
    // is the creator's source; in Docker the entrypoint puts them beside it.
    // Each game run from one checkout gets its own, so none lists another's.
    dir:
      process.env.REPLAY_DIR ||
      (gameDir() ? path.join('replays', dbName) : 'replays'),
  },
  audit: {
    // How long the administrative trail is kept. MongoDB expires the entries
    // itself (TTL index), so the collection stays bounded on a server nobody
    // prunes by hand. Long enough that a complaint about a GM weeks ago still
    // has evidence behind it; a floor of one day so it cannot be set to
    // effectively off by accident.
    retentionDays: parseIntEnv('AUDIT_RETENTION_DAYS', 90, {
      min: 1,
      max: 3650,
    }),
  },
  auth: {
    // Login/register throttle, per IP. The default is strict
    // (credential stuffing is the threat), which also means every load-test
    // bot logging in from one machine trips it after twenty. Raise it for a
    // local benchmark run; leave it alone in production.
    rateLimitWindowMs: parseIntEnv('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60_000, {
      min: 1_000,
      max: 60 * 60_000,
    }),
    rateLimitMax: parseIntEnv('AUTH_RATE_LIMIT_MAX', 20, {
      min: 1,
      max: 1_000_000,
    }),
  },
  ws: {
    maxPayloadBytes: parseIntEnv('WS_MAX_PAYLOAD_BYTES', 16 * 1024, {
      min: 1024,
      max: 1024 * 1024,
    }),
    heartbeatIntervalMs: parseIntEnv('WS_HEARTBEAT_INTERVAL_MS', 30_000, {
      min: 5_000,
      max: 120_000,
    }),
    // A client whose outbound buffer exceeds this is sent nothing, not even a
    // snapshot, until it drains, bounding memory for slow consumers.
    maxBufferedBytes: parseIntEnv('WS_MAX_BUFFERED_BYTES', 256 * 1024, {
      min: 16 * 1024,
      max: 16 * 1024 * 1024,
    }),
  },
  gameLoop: {
    tickRate: parseIntEnv('TICK_RATE', TICK_RATE, { min: 1, max: 240 }),
    maxUpdatesPerTick: parseIntEnv('MAX_UPDATES_PER_TICK', 2, {
      min: 1,
      max: 20,
    }),
    // How long the loop may go without a tick before the watchdog takes the
    // process down for its supervisor to restart; 0 turns it off. A tick is
    // 50 ms and the longest honest pause, a major GC, is hundreds of ms.
    stallTimeoutMs: parseIntEnv('TICK_STALL_TIMEOUT_MS', 15_000, {
      min: 0,
      max: 600_000,
    }),
  },
  net: {
    aoiMarginTiles: parseIntEnv('NET_AOI_MARGIN_TILES', 2, {
      min: 0,
      max: 20,
    }),
    // Ticks between one viewer's world updates. 2 halves the messages written,
    // and the client learns of the world, its own corrections included, up to a
    // tick later. A viewer that skips ticks gets their deltas merged, so the
    // saving does not come back as bandwidth. The default is 1, every tick.
    viewerCadenceTicks: parseIntEnv('NET_VIEWER_CADENCE_TICKS', 1, {
      min: 1,
      max: 4,
    }),
  },
  instance: {
    wsPublicUrl: parseWsPublicUrl(),
    mapIds,
    heartbeatMs: parseIntEnv('INSTANCE_HEARTBEAT_MS', 30_000, {
      min: 5_000,
      max: 300_000,
    }),
  },
  scripting: {
    // Enables the Monaco script editor endpoints and UI. Saving a script is
    // remote code execution on the server (see the trust model in
    // engine/scripting/sandbox.ts), so it is off unless an operator opts in.
    editorEnabled: process.env.SCRIPT_EDITOR_ENABLED === 'true',
    // How long one script handler may take before it counts as slow, and how
    // many slow runs it gets before it stops running. The budget is a fraction
    // of the 50ms tick. It is measured, not enforced: a handler that never
    // returns cannot be interrupted from inside (handlerBudget.ts).
    handlerBudgetMs: parseIntEnv('SCRIPT_HANDLER_BUDGET_MS', 8, {
      min: 1,
      max: 1_000,
    }),
    handlerBudgetStrikes: parseIntEnv('SCRIPT_HANDLER_BUDGET_STRIKES', 5, {
      min: 1,
      max: 1_000,
    }),
    // The budget above catches one slow call. This catches the other failure:
    // many cheap ones. A handler just under the budget on every tick never
    // strikes and still owns a sixth of the frame, forever. Over this window
    // the cost of each script is added up and compared with wall time, and a
    // script over the share gets one line naming it.
    handlerTimeWindowMs: parseIntEnv('SCRIPT_TIME_WINDOW_MS', 60_000, {
      min: 1_000,
      max: 10 * 60_000,
    }),
    handlerShareWarnPercent: parseIntEnv('SCRIPT_TIME_SHARE_WARN_PERCENT', 10, {
      min: 1,
      max: 100,
    }),
  },
  persistence: {
    playerSnapshotIntervalMs: parseIntEnv(
      'PLAYER_SNAPSHOT_INTERVAL_MS',
      30_000,
      {
        min: 0,
        max: 60 * 60 * 1000,
      },
    ),
  },
  cors: {
    allowedOrigins: corsAllowedOrigins,
    options: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (corsAllowedOrigins.includes('*')) return cb(null, true);
        if (corsAllowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
      // Without this a browser on another origin cannot read either header,
      // which is where both correlation ids live: the eight characters a
      // player reports, and the trace the request became on this side.
      exposedHeaders: ['X-Request-Id', 'traceparent'],
    } satisfies CorsOptions,
  },
} as const;

/**
 * The folder a game lives in, when it has one of its own: game.json, theme/,
 * assets/, scripts/, content/ and any modules it brings, so that switching
 * games is one variable, or one mount. Unset, the game is spread over the
 * working directory next to the engine. Read on each call, as the *_PATH
 * overrides are, so a test can point it somewhere.
 */
export function gameDir(): string | undefined {
  const dir = process.env['GAME_DIR'];
  return dir ? path.resolve(dir) : undefined;
}

export function gamePath(...parts: string[]): string {
  return path.resolve(gameDir() ?? '.', ...parts);
}

/**
 * The database a game's world is kept in. A name in MONGO_URI is the
 * operator's and wins. Without one, each game folder gets a database of its
 * own, named after the folder: maps, players and items live there rather than
 * in the folder, so two games sharing one would boot the second on the first
 * one's world, with its content pack merged over the top.
 */
export function mongoDbName(uri: string, dir = gameDir()): string {
  const named = /^mongodb(?:\+srv)?:\/\/[^/?]+\/([^?]+)/.exec(uri)?.[1];
  if (named) return decodeURIComponent(named);
  // Mongo caps a database name at 63 bytes and refuses / \ . " $ and spaces.
  const fromDir = dir
    ? path
        .basename(dir)
        .replace(/[^\w-]/g, '_')
        .slice(0, 63)
    : '';
  return fromDir || 'game';
}

// Every file under it is optional, so a mistyped folder would boot an empty
// game on defaults that looks fine.
const configuredGameDir = gameDir();
if (
  configuredGameDir &&
  !fs.statSync(configuredGameDir, { throwIfNoEntry: false })?.isDirectory()
) {
  throw new Error(
    `[config] GAME_DIR is ${configuredGameDir}, which is not a folder. ` +
      'Point it at the folder holding the game.json, or unset it to use the working directory.',
  );
}
