import express, {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
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

/** The registration methods a route file uses to attach a handler. */
const HANDLER_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'all',
  'use',
] as const;

type Registrar = (...args: unknown[]) => unknown;

/**
 * A `Router` whose handlers may be async. Express 4 ignores what a handler
 * returns, so a rejected promise hangs the request and, as an unhandled
 * rejection, kills the process with the tick loop in it. Forwarding the
 * rejection to `next` turns both into the 500 `handleRouteError` answers.
 * Wrapping at registration covers every route without opting in.
 */
export function createRouter(): Router {
  const router = Router();
  // The methods are overloaded a dozen ways each; the wrapper only forwards
  // arguments, so it types them as opaque rather than restating the overloads.
  const registrars = router as unknown as Record<string, Registrar>;
  for (const method of HANDLER_METHODS) {
    const register = registrars[method]!.bind(router);
    registrars[method] = (...args: unknown[]) =>
      register(...args.map(forwardRejection));
  }
  return router;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

function forwardRejection(arg: unknown): unknown {
  // Paths, arrays and error middleware pass through untouched: Express
  // recognises the last by its four arguments, so it must keep them.
  if (typeof arg !== 'function' || arg.length === 4) return arg;
  const handler = arg as RequestHandler;
  return function asyncSafeHandler(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result: unknown = handler(req, res, next);
      // Thenable rather than `instanceof Promise`: a handler that returns a
      // mongoose query straight out rejects the same way.
      if (isThenable(result)) void Promise.resolve(result).catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Last middleware in the chain: answers whatever `createRouter` forwarded.
 *
 * Express's built-in handler leaks the stack in development and sends HTML to
 * callers that asked for JSON, so the body stays generic and the detail goes
 * to the log.
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
