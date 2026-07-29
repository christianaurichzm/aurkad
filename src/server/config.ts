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

if (nodeEnv === 'production' && !process.env.CORS_ALLOWED_ORIGINS) {
  throw new Error(
    '[config] CORS_ALLOWED_ORIGINS must be set in production. ' +
      'Use a comma-separated list of allowed origins, e.g. https://yourgame.com',
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
if (
  process.env.WS_PUBLIC_URL &&
  mapIds &&
  process.env.ALLOW_UNSAFE_MULTI_INSTANCE !== 'true'
) {
  throw new Error(
    '[config] Multi-instance mode (WS_PUBLIC_URL + MAP_IDS) is disabled: login presence ' +
      'is per-process, so the same account can log in on two instances at once and lose ' +
      'progress when their saves overwrite each other. Run a single instance (unset one of ' +
      'the two), or set ALLOW_UNSAFE_MULTI_INSTANCE=true to accept the risk.',
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
