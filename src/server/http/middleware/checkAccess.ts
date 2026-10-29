import { Request, Response, NextFunction } from 'express';
import { Access } from '../../../shared/types.js';
import {
  recordAdminAction,
  summarizeDetails,
} from '../../services/auditService.js';

// Reads only: a trail of who looked at the npc list is noise that buries the
// entries that matter. What an auditor needs is every attempt to CHANGE
// something, allowed or not.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// The web console records its own entry, with the command and its arguments
// parsed out. Logging the request too would double every console action, and
// the request version is the less useful of the two. Only for requests the gate
// lets through: a refused one never reaches the console to be recorded there.
const RECORDED_ELSEWHERE = new Set(['/admin/console']);

/** Path without the query string, which can carry a session id or a token. */
const pathOf = (req: Request<unknown>): string => `${req.baseUrl}${req.path}`;

/**
 * Who the request is aimed at.
 *
 * Every moderation route names its subject in one of these, so the trail can
 * answer "what was done to this player" without knowing each route's body
 * shape. A route that names nobody (most content edits) simply has no target.
 */
function targetOf(req: Request<unknown>): string | undefined {
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const key of ['username', 'player', 'name', 'to', 'mapId']) {
    const value = body[key];
    if (typeof value === 'string' && value) return value;
  }
  // Shape-blind like the body above: this gate fronts every route.
  const params = req.params as Record<string, unknown>;
  const param = params['id'] ?? params['name'] ?? params['mapId'];
  return typeof param === 'string' && param ? param : undefined;
}

/**
 * Gate on access level, and leave a trail of every privileged mutation. The
 * audit lives here because every route passes through, so a route added
 * tomorrow is covered without anyone remembering. Denials are recorded too,
 * since an account probing above its level is what the log is for.
 */
const checkAccess = (requiredAccess: Access) => {
  // Generic in the params: a middleware that pins them makes Express infer
  // the whole chain's params from here instead of from each route's path.
  return <P>(req: Request<P>, res: Response, next: NextFunction) => {
    const username = req.session.username;
    const accessLevel = req.session.accessLevel;
    // A route any player may call is gameplay (a purchase, a point spent), not
    // a privileged action, and every shop visit would bury the moderation log.
    const audited = requiredAccess > Access.USER && MUTATING.has(req.method);

    const entry = () => ({
      actor: username,
      actorAccess: accessLevel,
      requiredAccess,
      action: `${req.method} ${pathOf(req)}`,
      target: targetOf(req),
      source: 'http' as const,
      ip: req.ip,
      details: summarizeDetails(req.body),
    });

    if (!username || accessLevel === undefined) {
      if (audited) {
        recordAdminAction({ ...entry(), outcome: 'denied', status: 401 });
      }
      return res.status(401).send('Unauthorized');
    }

    if (accessLevel < requiredAccess) {
      if (audited) {
        recordAdminAction({ ...entry(), outcome: 'denied', status: 403 });
      }
      return res.status(403).send('Forbidden');
    }

    if (audited && !RECORDED_ELSEWHERE.has(pathOf(req))) {
      // Recorded on finish, not here: the status is what says whether the ban
      // actually landed or died on a validation error, and an entry claiming
      // an action that never happened is worse than no entry at all.
      const pending = entry();
      res.on('finish', () =>
        recordAdminAction({
          ...pending,
          outcome: 'allowed',
          status: res.statusCode,
        }),
      );
    }

    next();
  };
};

export default checkAccess;
