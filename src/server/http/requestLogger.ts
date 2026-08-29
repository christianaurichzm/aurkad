import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { reqCtx } from '../context.js';
import { formatTraceparent, parseTraceparent, startSpan } from '../tracing.js';

/**
 * One span per request, and the ids that make every line under it findable.
 * An incoming `traceparent` is continued, joining the browser's attempt or
 * another instance's hand-off to this one; a caller can invent one, but it
 * is a correlation id, not a credential. `X-Request-Id` is the head of the
 * trace id, eight characters a player can read out that lead to the trace.
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const span = startSpan(`${req.method} ${req.path}`, {
    parent: parseTraceparent(req.headers['traceparent']),
    kind: 'server',
    attributes: {
      'http.request.method': req.method,
      'url.path': req.path,
    },
  });
  const requestId = span.context.traceId.slice(0, 8);
  const start = Date.now();

  res.setHeader('X-Request-Id', requestId);
  res.setHeader('traceparent', formatTraceparent(span.context));

  reqCtx.run(
    { requestId, trace: span.context, username: req.session?.username },
    () => {
      res.on('finish', () => {
        span.setAttributes({
          'http.response.status_code': res.statusCode,
          // Read at the end, not at the start: the session only exists once
          // whatever authenticated the request has run.
          'enduser.id': req.session?.username,
        });
        // A 5xx is this process failing; a 4xx is the caller being told no, and
        // marking those as errors makes every wrong password an incident.
        if (res.statusCode >= 500) span.fail(`status ${res.statusCode}`);
        span.end();

        logger.info(`${req.method} ${req.path}`, {
          status: res.statusCode,
          ms: Date.now() - start,
        });
      });

      next();
    },
  );
}
