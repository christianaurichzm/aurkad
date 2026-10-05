import bcrypt from 'bcrypt';
import { type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import {
  parseBody,
  LoginBodySchema,
  TwoFactorDisableBodySchema,
  TwoFactorEnableBodySchema,
  TwoFactorSetupBodySchema,
} from '../bodySchemas.js';
import {
  authEpochOf,
  getPlayerForAuthentication,
  getPlayerByNameFromDb,
} from '../../services/player/playerService.js';
import checkAccess from '../middleware/checkAccess.js';
import { listAuditLog } from '../../services/auditService.js';
import {
  checkSecondFactor,
  disableTwoFactor,
  enableTwoFactor,
  newSecret,
  otpauthUrl,
  twoFactorStatus,
} from '../../services/player/twoFactorService.js';
import { logger } from '../../logger.js';
import { config } from '../../config.js';
import { createRouter } from '../../app.js';
import { createAuthLimiter } from '../middleware/rateLimit.js';

// Standalone operator session for the /admin dashboard: authenticate and
// grant the panel WITHOUT registering a player in the game world, since
// moderation needs only the session's access level. The "may I open this
// editor" pings live here too: each answers the session's access level for
// a different domain, so no domain router owns them.
export function createAdminAuthRouter() {
  const router = createRouter();
  // Its own instance, not the player one: an operator locked out because
  // players were fumbling passwords is exactly when the panel is needed.
  const adminLimiter = createAuthLimiter();

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

      const doc = await getPlayerForAuthentication(username);
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

      // The password was right; whether that is enough is the factor's answer.
      const second = await checkSecondFactor(username, body.totpToken);
      if (second !== 'ok') {
        return res.status(401).json({
          twoFactorRequired: true,
          message:
            second === 'required'
              ? 'This account needs its authentication code.'
              : 'That code is wrong or already used.',
        });
      }

      const authEpoch = doc.authEpoch ?? 0;
      if ((await authEpochOf(username)) !== authEpoch) {
        return res
          .status(401)
          .json({ message: 'Invalid username or password' });
      }
      req.session.username = username;
      req.session.accessLevel = access;
      req.session.authEpoch = authEpoch;
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

  /**
   * The second factor, from the panel of the operator it belongs to. Under
   * `checkAccess`, so turning it on or off lands in the audit trail. No route
   * acts on another account: an operator who lost the phone and the codes is
   * unlocked at the console with `twofactor`, the path that proves who asks.
   */
  router.get(
    '/admin/2fa',
    checkAccess(Access.MOD),
    async (req: ExtendedRequest, res: Response) => {
      res.json(await twoFactorStatus(req.session.username!));
    },
  );

  router.post(
    '/admin/2fa/setup',
    checkAccess(Access.MOD),
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(TwoFactorSetupBodySchema, req.body, res);
      if (!body) return;

      const username = req.session.username!;
      const doc = await getPlayerByNameFromDb(username);
      if (!doc || !(await bcrypt.compare(body.currentPassword, doc.password))) {
        return res.status(403).json({ message: 'Current password is wrong' });
      }

      const secret = newSecret();
      req.session.pendingTotpSecret = secret;
      req.session.save((err) => {
        if (err) {
          logger.error('2fa enrollment save failed', { err });
          return res.status(500).json({ message: 'Session error' });
        }
        // The secret in the clear is the enrollment: the app has to read it,
        // by camera or by hand, and there is no second delivery.
        res.json({ secret, otpauthUrl: otpauthUrl(username, secret) });
      });
    },
  );

  router.post(
    '/admin/2fa/enable',
    checkAccess(Access.MOD),
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(TwoFactorEnableBodySchema, req.body, res);
      if (!body) return;

      const secret = req.session.pendingTotpSecret;
      if (!secret) {
        return res
          .status(409)
          .json({ message: 'Start the setup again: nothing to confirm.' });
      }

      const result = await enableTwoFactor(
        req.session.username!,
        secret,
        body.totpToken,
      );
      if (!result.ok) {
        return res.status(400).json({ message: 'That code is wrong.' });
      }

      delete req.session.pendingTotpSecret;
      // Shown once, and the panel says so: no route reprints them, as one-use
      // passwords the server hands back on request are no second factor.
      res.json({ recoveryCodes: result.recoveryCodes });
    },
  );

  router.post(
    '/admin/2fa/disable',
    checkAccess(Access.MOD),
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(TwoFactorDisableBodySchema, req.body, res);
      if (!body) return;

      const username = req.session.username!;
      const doc = await getPlayerByNameFromDb(username);
      if (!doc || !(await bcrypt.compare(body.currentPassword, doc.password))) {
        return res.status(403).json({ message: 'Current password is wrong' });
      }

      const second = await checkSecondFactor(username, body.totpToken);
      if (second !== 'ok') {
        return res.status(403).json({ message: 'That code is wrong.' });
      }

      await disableTwoFactor(username);
      res.json({ success: true });
    },
  );

  router.post('/admin/logout', (req: ExtendedRequest, res: Response) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.post('/openMapEditor', checkAccess(Access.ADMIN), (_req, res) => {
    res.status(200).send('Authorized');
  });

  router.post('/openModEditor', checkAccess(Access.MOD), (_req, res) => {
    res.status(200).send('Authorized');
  });

  router.post('/openContentEditor', checkAccess(Access.ADMIN), (_req, res) => {
    res.status(200).send('Authorized');
  });

  return router;
}
