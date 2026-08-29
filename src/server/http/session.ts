import session from 'express-session';
import MongoStore from 'connect-mongo';
import type { RequestHandler, Request } from 'express';
import type { Access, PlayerServer } from '../../shared/types.js';
import { config } from '../config.js';

declare module 'express-session' {
  interface SessionData {
    username: PlayerServer['name'];
    accessLevel: Access;
    assetKey: string;
    /**
     * A second-factor secret that has been shown but not yet proven. Kept
     * here, not in the database, so an abandoned enrollment leaves nothing: it
     * becomes real in the TwoFactor collection or dies with this session.
     */
    pendingTotpSecret: string;
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
    store: MongoStore.create({
      mongoUrl: config.mongoUri,
      collectionName: 'sessions',
      ttl: 7 * 24 * 60 * 60, // 7 days in seconds
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.USE_SECURE_COOKIES === 'true',
    },
  });
}
