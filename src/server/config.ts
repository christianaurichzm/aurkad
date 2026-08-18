import crypto from 'crypto';
import { createRequire } from 'module';
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

const require = createRequire(import.meta.url);
try {
  const dotenv = require('dotenv') as typeof import('dotenv');
  dotenv.config({
    path: nodeEnv === 'production' ? './.env.production' : './.env.development',
  });
} catch {
  if (nodeEnv !== 'production') {
    console.warn('[config] dotenv not available; skipping .env loading.');
  }
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

if (nodeEnv === 'production' && !process.env.SESSION_SECRET) {
  throw new Error(
    '[config] SESSION_SECRET must be set in production. Use a secure random string (e.g. openssl rand -hex 32).',
  );
}

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

// A short token is worse than none: it reads as protection while being
// guessable, and this endpoint is a capacity map of the server. Fail at boot
// rather than serve it.
const metricsToken = process.env.METRICS_TOKEN?.trim() || undefined;
if (metricsToken !== undefined && metricsToken.length < 16) {
  throw new Error(
    '[config] METRICS_TOKEN must be at least 16 characters. Use a secure random string (e.g. openssl rand -hex 32).',
  );
}

// An all-blank MAP_IDS parses to [], which would read as sharding. It means
// "own all maps", like unset, so both become undefined here.
const rawMapIds = parseCsvEnv('MAP_IDS');
const mapIds = rawMapIds?.length ? rawMapIds : undefined;

// Sharding is wired end to end (registry, heartbeat, cross-map redirect),
// but login presence is per-process: authRoutes checks the local
// playersWsMap, so one account can log in on two instances whose saves
// clobber each other. So that mode refuses to boot rather than silently
// losing player data.
if (process.env.WS_PUBLIC_URL && mapIds) {
  if (process.env.ALLOW_UNSAFE_MULTI_INSTANCE !== 'true') {
    throw new Error(
      '[config] Multi-instance mode (WS_PUBLIC_URL + MAP_IDS) is disabled: login presence ' +
        'is per-process, so the same account can log in on two instances at once and lose ' +
        'progress when their saves overwrite each other. Run a single instance (unset one of ' +
        'the two), or set ALLOW_UNSAFE_MULTI_INSTANCE=true to accept the risk.',
    );
  }
  // The opt-in is set once and outlives whoever set it, so it says so on every
  // boot: the risk it accepts is silent data loss, which has no other symptom.
  console.warn(
    '[config] ALLOW_UNSAFE_MULTI_INSTANCE=true: login presence is per-process, so the same ' +
      'account logging in on two instances loses progress when the saves overwrite each other.',
  );
}

const sessionSecret =
  process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');

export const config = {
  nodeEnv,
  port: parseIntEnv('PORT', 8080, { min: 1, max: 65535 }),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/game',
  imagesBaseUrl: process.env.IMAGES_BASE_URL || '.',
  session: {
    secret: sessionSecret,
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
    // Where mail goes. `log` writes it to the server log, so a game with no
    // mail account can still reset a password by hand, and `none` drops it.
    transport: process.env.MAIL_TRANSPORT === 'none' ? 'none' : 'log',
    // What a link in a message points at. Only the operator knows the address
    // players type, so a wrong guess here produces a link nobody can open;
    // the fallback is the local one, which is right in development and
    // obviously wrong anywhere else.
    publicBaseUrl: (
      process.env.PUBLIC_BASE_URL ||
      `http://localhost:${parseIntEnv('PORT', 8080, { min: 1, max: 65535 })}`
    ).replace(/\/+$/, ''),
  },
  economy: {
    // How often every item in the world is counted, and how long counts are
    // kept. The job walks every player document, so it runs rarely: whether a
    // total moved beyond what loot and spending explain is asked in hours.
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
    dir: process.env.REPLAY_DIR || 'replays',
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
    // Login and register throttle, per IP. Strict by default against
    // credential stuffing, so load-test bots from one machine trip it after
    // twenty. Raise it for a local benchmark; leave it in production.
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
    // A client whose outbound buffer exceeds this is skipped for the tick
    // rather than sent more snapshots, bounding memory for slow consumers.
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
    wsPublicUrl: process.env.WS_PUBLIC_URL,
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
    } satisfies CorsOptions,
  },
} as const;
