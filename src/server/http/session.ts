import session from 'express-session';
import type { RequestHandler, Request } from 'express';
import type { Access, PlayerServer } from '../../shared/types.js';
import { config } from '../config.js';

declare module 'express-session' {
  interface SessionData {
    username: PlayerServer['name'];
    accessLevel: Access;
    assetKey: string;
  }
}

export type ExtendedRequest = Request & {
  session: session.Session & Partial<session.SessionData>;
};

export function createSessionMiddleware(): RequestHandler {
  return session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.USE_SECURE_COOKIES === 'true',
    },
  });
}
