import { reqCtx } from './context.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
type LogCtx = Record<string, unknown>;

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Makes errors survive JSON.stringify: `name`, `message` and `stack` are
 * non-enumerable, so `{ err }` would print as `{"err":{}}`. Shape-tested,
 * since script errors come from a vm realm's Error and fail `instanceof`,
 * and theirs are the stacks that matter most.
 */
function withErrors(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const candidate = value as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
  };
  if (typeof candidate.message !== 'string') return value;
  if (typeof candidate.stack !== 'string') return value;
  return {
    name: typeof candidate.name === 'string' ? candidate.name : 'Error',
    message: candidate.message,
    stack: candidate.stack,
  };
}

function log(level: Level, msg: string, ctx?: LogCtx): void {
  const stored = reqCtx.getStore();
  const enriched: LogCtx = {
    ...(stored?.requestId && { requestId: stored.requestId }),
    ...(stored?.username && { username: stored.username }),
    ...ctx,
  };
  const hasCtx = Object.keys(enriched).length > 0;

  const line = isDev
    ? `[${level.toUpperCase()}] ${msg}${hasCtx ? ' ' + JSON.stringify(enriched, withErrors) : ''}`
    : JSON.stringify(
        { ts: new Date().toISOString(), level, msg, ...enriched },
        withErrors,
      );

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogCtx) => {
    if (process.env.LOG_LEVEL === 'debug') log('debug', msg, ctx);
  },
  info: (msg: string, ctx?: LogCtx) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogCtx) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogCtx) => log('error', msg, ctx),
};
