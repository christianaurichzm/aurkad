import session, { type SessionData } from 'express-session';
import MongoStore from 'connect-mongo';
import type { RequestHandler, Request } from 'express';
import type { Access, PlayerServer } from '../../shared/types.js';
import { config } from '../config.js';
import { playerRepository } from '../persistence/playerRepository.js';

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
    /**
     * The account generation this session was minted against. Undefined reads
     * as 0, the generation of an account never bumped, so sessions without the
     * field stay valid across a deploy.
     */
    authEpoch: number;
  }
}

export type ExtendedRequest = Request & {
  session: session.Session & Partial<session.SessionData>;
};

/**
 * Whether the account still stands behind what this session claims.
 *
 * Fails closed: the alternative is a check that anyone can skip by making the
 * database flake, and an unreachable Mongo already means the server is not
 * serving (see /readyz).
 */
async function accountStillBacks(
  session: Partial<SessionData>,
): Promise<boolean> {
  const name = session.username;
  if (!name) return true;
  try {
    const current = await playerRepository.authEpochOf(name);
    return current !== null && current === (session.authEpoch ?? 0);
  } catch {
    return false;
  }
}

/**
 * Session state, plus the check that it has not outlived its account. A
 * session carries who it is and what it may do, taken at login, and nothing
 * downstream re-reads the account, so without this a demotion or a password
 * reset would leave the old session as authoritative as ever. A session that
 * no longer matches is emptied rather than answered, since this also runs in
 * front of the WebSocket upgrade, where there is no response to write.
 */
export function createSessionMiddleware(
  store: session.Store = MongoStore.create({
    mongoUrl: config.mongoUri,
    dbName: config.mongoDbName,
    collectionName: 'sessions',
    ttl: 7 * 24 * 60 * 60, // 7 days in seconds
  }),
): RequestHandler {
  const withSession = session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    store,
    // Browsers scope cookies by host, not port, so two games on one host
    // (localhost, or a server reached by its IP) would each overwrite the
    // other's login. Instances of one game share a database, and with it the
    // name, so a warp to another instance stays signed in.
    name: `${config.mongoDbName}.sid`,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.USE_SECURE_COOKIES === 'true',
    },
  });

  return (req, res, next) => {
    withSession(req, res, (err?: unknown) => {
      // A store that cannot be read hands over an error, or nothing at all
      // while it is disconnected. Either way there is no session here, and this
      // runs from the store's callback, where a throw takes the process down.
      const { session: current } = req as Partial<ExtendedRequest>;
      if (err || !current?.username) return next(err);
      void accountStillBacks(current).then((ok) => {
        if (!ok) {
          delete current.username;
          delete current.accessLevel;
        }
        next();
      });
    });
  };
}
