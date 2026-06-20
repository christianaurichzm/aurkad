import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID().slice(0, 8);
  const start = Date.now();

  res.setHeader('X-Request-Id', requestId);
  res.locals['requestId'] = requestId;

  res.on('finish', () => {
    logger.info(`${req.method} ${req.path}`, {
      requestId,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });

  next();
}
