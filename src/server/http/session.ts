import session, { type SessionData } from 'express-session';
import MongoStore from 'connect-mongo';
import type { RequestHandler, Request } from 'express';
import type { Access, PlayerServer } from '../../shared/types.js';
import { config } from '../config.js';
import { playerRepository } from '../persistence/playerRepository.js';
import { getPlayerByName } from '../sim/world.js';

declare module 'express-session' {
  interface SessionData {
    username: PlayerServer['name'];
    /** The account's, read again on every request (see accountStillBacks). */
    accessLevel: Access;
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
 * Whether the account still stands behind this session, and the level it
 * acts at now: the live player's when in this world, where a GM command or
 * a script changes it in place, else the database's. So a promotion or
 * demotion holds from the next request without ending any session. Fails
 * closed, or a flaky database would skip the check (see /readyz).
 */
async function accountStillBacks(
  session: Partial<SessionData>,
): Promise<boolean> {
  const name = session.username;
  if (!name) return true;
  try {
    const account = await playerRepository.authOf(name);
    if (account === null || account.authEpoch !== (session.authEpoch ?? 0))
      return false;
    session.accessLevel = getPlayerByName(name)?.access ?? account.access;
    return true;
  } catch {
    return false;
  }
}

/**
 * Session state, plus the check that it has not outlived its account. A
 * session carries who it is and the account generation it was minted
 * against; a password reset moves the generation and ends older sessions,
 * and the level is read from the account on each request. A session that no
 * longer matches is emptied rather than answered, since this also runs in
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
