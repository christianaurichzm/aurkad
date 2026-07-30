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
// the request version is the less useful of the two.
const RECORDED_ELSEWHERE = new Set(['/admin/console']);

/** Path without the query string, which can carry a session id or a token. */
const pathOf = (req: Request): string => `${req.baseUrl}${req.path}`;

/**
 * Who the request is aimed at.
 *
 * Every moderation route names its subject in one of these, so the trail can
 * answer "what was done to this player" without knowing each route's body
 * shape. A route that names nobody (most content edits) simply has no target.
 */
function targetOf(req: Request): string | undefined {
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const key of ['username', 'player', 'name', 'to', 'mapId']) {
    const value = body[key];
    if (typeof value === 'string' && value) return value;
  }
  const param = req.params['id'] ?? req.params['name'] ?? req.params['mapId'];
  return typeof param === 'string' && param ? param : undefined;
}

/**
 * Gate on access level, and leave a trail of every privileged mutation. The
 * audit lives here because every route passes through, so a route added
 * tomorrow is covered without anyone remembering. Denials are recorded too,
 * since an account probing above its level is what the log is for.
 */
const checkAccess = (requiredAccess: Access) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const username = req.session.username;
    const accessLevel = req.session.accessLevel;
    const audited =
      MUTATING.has(req.method) && !RECORDED_ELSEWHERE.has(pathOf(req));

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

    if (audited) {
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
