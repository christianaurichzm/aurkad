import { Router, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import checkAccess from '../middleware/checkAccess.js';
import { listAuditLog } from '../../services/admin/auditService.js';
import { logger } from '../../logger.js';

// Read side of the administrative trail. ADMIN only, and narrow: there is no
// write and no delete endpoint, because a log an operator can edit answers
// nothing about that operator.
export function createAuditRouter() {
  const router = Router();

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

  return router;
}
