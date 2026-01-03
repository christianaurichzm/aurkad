import crypto from 'crypto';
import { createRequire } from 'module';
import type { CorsOptions } from 'cors';

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
  if (opts.min !== undefined && value < opts.min) return fallback;
  if (opts.max !== undefined && value > opts.max) return fallback;
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

const sessionSecret =
  process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');

if (nodeEnv === 'production') {
  if (!process.env.SESSION_SECRET) {
    console.warn(
      '[config] SESSION_SECRET not set; using an ephemeral secret (sessions will reset on restart).',
    );
  }
  if (!process.env.CORS_ALLOWED_ORIGINS) {
    console.warn(
      '[config] CORS_ALLOWED_ORIGINS not set; allowing any Origin (set a comma-separated allowlist in production).',
    );
  }
}

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
  ws: {
    maxPayloadBytes: parseIntEnv('WS_MAX_PAYLOAD_BYTES', 16 * 1024, {
      min: 1024,
      max: 1024 * 1024,
    }),
    heartbeatIntervalMs: parseIntEnv('WS_HEARTBEAT_INTERVAL_MS', 30_000, {
      min: 5_000,
      max: 120_000,
    }),
  },
  gameLoop: {
    tickRate: parseIntEnv('TICK_RATE', 20, { min: 1, max: 240 }),
    maxUpdatesPerTick: parseIntEnv('MAX_UPDATES_PER_TICK', 2, {
      min: 1,
      max: 20,
    }),
  },
  net: {
    interestRadiusTiles: parseIntEnv('NET_INTEREST_RADIUS_TILES', 0, {
      min: 0,
      max: 200,
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
