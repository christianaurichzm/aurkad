// How often one caller may hit HTTP, and what "one caller" means. With
// nothing configured, Express reports the socket's address, which behind
// the proxy compose.game.yml puts in front is the proxy for every request:
// one shared bucket, where any client can lock out everyone at login. Hence
// `config.http.trustProxy`, and one key function for every limiter.
//
// A logged-in caller is keyed by name, fairer than an address a household
// shares or an abuser rotates; the address is the fallback before login.

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { config } from '../../config.js';

/** Health probes answer before this runs; see where it is mounted in server.ts. */
function keyFor(req: Request): string {
  const username = req.session?.username;
  if (username) return `user:${username}`;
  // Not `req.ip` directly: the helper masks IPv6 down to a subnet, so a caller
  // with a /64 to spend cannot get a fresh bucket per request.
  return ipKeyGenerator(req.ip ?? '');
}

function limiter(windowMs: number, max: number, message: string) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: keyFor,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

/**
 * Everything that is not a login attempt.
 *
 * One limiter for the whole surface rather than a tier per route: a limit each
 * route has to remember to opt into is a limit the next route forgets, and the
 * ungated reads are the ones worth covering (a map document with all its tiles,
 * an asset the server XORs byte by byte on the tick's own thread).
 */
export function createHttpLimiter(): RequestHandler {
  return limiter(
    config.http.rateLimitWindowMs,
    config.http.rateLimitMax,
    'Too many requests, please slow down.',
  );
}

/**
 * Login and register, player side and operator side.
 *
 * Far stricter than the general limit, and separate instances so
 * that players fumbling their passwords cannot use up the budget an operator
 * needs to get into the admin panel and deal with it.
 */
export function createAuthLimiter(): RequestHandler {
  return limiter(
    config.auth.rateLimitWindowMs,
    config.auth.rateLimitMax,
    'Too many requests, please try again later.',
  );
}
