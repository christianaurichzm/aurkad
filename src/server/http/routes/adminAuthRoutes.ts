import bcrypt from 'bcrypt';
import { type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import { parseBody, LoginBodySchema } from '../bodySchemas.js';
import { getPlayerByNameFromDb } from '../../services/player/playerService.js';
import checkAccess from '../middleware/checkAccess.js';
import { listAuditLog } from '../../services/auditService.js';
import { logger } from '../../logger.js';
import { config } from '../../config.js';
import { createRouter } from '../../app.js';

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});

// Standalone operator session for the /admin dashboard: authenticate and grant
// the panel WITHOUT registering a player in the game world. Moderation only
// needs the session's access level, so the operator never appears in-game.
export function createAdminAuthRouter() {
  const router = createRouter();

  router.get('/admin/session', (req: ExtendedRequest, res: Response) => {
    const { username, accessLevel } = req.session;
    if (!username || accessLevel === undefined || accessLevel < Access.MOD) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    res.json({
      username,
      access: accessLevel,
      scriptEditorEnabled: config.scripting.editorEnabled,
    });
  });

  router.post(
    '/admin/login',
    adminLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(LoginBodySchema, req.body, res);
      if (!body) return;
      const { username, password } = body;

      const doc = await getPlayerByNameFromDb(username);
      if (!doc || !(await bcrypt.compare(password, doc.password))) {
        return res
          .status(401)
          .json({ message: 'Invalid username or password' });
      }

      const access = doc.access ?? Access.USER;
      if (access < Access.MOD) {
        return res
          .status(403)
          .json({ message: 'This account cannot access the admin panel.' });
      }

      req.session.username = username;
      req.session.accessLevel = access;
      req.session.save((err) => {
        if (err) {
          logger.error('admin session save failed', { err });
          return res.status(500).json({ message: 'Session error' });
        }
        res.json({
          username,
          access,
          scriptEditorEnabled: config.scripting.editorEnabled,
        });
      });
    },
  );

  // Read side of the administrative trail: ADMIN only, and narrow.
  // There is no write and no delete endpoint, because a log the audited
  // operator can edit answers nothing about that operator.
  router.get(
    '/admin/audit',
    checkAccess(Access.ADMIN),
    async (req: ExtendedRequest, res: Response) => {
      const { actor, action, outcome, before, limit } = req.query;
      try {
        res.json(
          await listAuditLog({
            actor: typeof actor === 'string' ? actor : undefined,
            action: typeof action === 'string' ? action : undefined,
            outcome:
              outcome === 'allowed' || outcome === 'denied'
                ? outcome
                : undefined,
            before: typeof before === 'string' ? Number(before) : undefined,
            limit: typeof limit === 'string' ? Number(limit) : undefined,
          }),
        );
      } catch (err) {
        logger.error('[audit] query failed', { err });
        res.status(500).json({ error: 'Could not read the audit log.' });
      }
    },
  );

  router.post('/admin/logout', (req: ExtendedRequest, res: Response) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  return router;
}
