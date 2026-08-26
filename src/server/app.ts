import express, {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { logger } from './logger.js';
import { requestLoggerMiddleware } from './http/requestLogger.js';

export function createApp() {
  const app = express();

  // Decides `req.ip`, which rate limits key on for a caller with no session.
  // Express's default trusts nothing, as the header is anyone's to write;
  // behind a proxy this must be set (see rateLimit.ts).
  app.set('trust proxy', config.http.trustProxy);

  app.use(helmet());
  app.use(requestLoggerMiddleware);
  app.use(express.json({ limit: config.http.jsonBodyLimit }));
  app.use(cors(config.cors.options));

  return app;
}

/**
 * The router every route file builds on.
 *
 * Express forwards a rejected promise to the error chain, so an async handler
 * that throws answers 500 instead of hanging the request and killing the
 * process on the unhandled rejection.
 */
export function createRouter(): Router {
  return Router();
}

/**
 * Last middleware in the chain: answers whatever a route forwarded.
 *
 * Express's own handler leaks the stack in development and sends HTML to
 * callers that asked for JSON.
 */
export function handleRouteError(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  logger.error('Unhandled error in route', {
    method: req.method,
    path: req.path,
    err,
  });
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
}

export default createApp();
