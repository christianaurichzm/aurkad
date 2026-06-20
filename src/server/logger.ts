type Level = 'debug' | 'info' | 'warn' | 'error';
type LogCtx = Record<string, unknown>;

const isDev = process.env.NODE_ENV !== 'production';

function log(level: Level, msg: string, ctx?: LogCtx): void {
  const line = isDev
    ? `[${level.toUpperCase()}] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}`
    : JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx });

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
