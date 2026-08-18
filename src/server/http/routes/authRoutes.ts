import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import {
  parseBody,
  ChangePasswordBodySchema,
  LoginBodySchema,
  RegisterBodySchema,
  ResetConfirmBodySchema,
  ResetRequestBodySchema,
} from '../bodySchemas.js';
import { logger } from '../../logger.js';
import { getPlayerById, registerPlayer } from '../../sim/world.js';
import { addPlayerOnMap } from '../../services/world/mapService.js';
import {
  createPlayer,
  disconnectPlayer,
  enrichPlayer,
  getPlayerByNameFromDb,
} from '../../services/player/playerService.js';
import { getBan, unbanPlayer } from '../../services/content/banService.js';
import { emit } from '../../engine/hooks.js';
import { toMapMeta } from '../../net/serialization.js';
import { serverState } from '../../services/world/serverState.js';
import { playersWsMap } from '../../net/connections.js';
import { WebSocket } from 'ws';
import { createRouter } from '../../app.js';
import { createAuthLimiter } from '../middleware/rateLimit.js';
import {
  changePassword,
  consumeResetToken,
  createResetToken,
  resetLink,
} from '../../services/player/passwordService.js';
import {
  mailReachesPlayers,
  sendMail,
} from '../../services/comms/mailService.js';

export function createAuthRouter() {
  const router = createRouter();
  const authLimiter = createAuthLimiter();

  router.post(
    '/login',
    authLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(LoginBodySchema, req.body, res);
      if (!body) return;
      const { username, password } = body;

      const playerDoc = await getPlayerByNameFromDb(username);
      if (!playerDoc) {
        return res
          .status(401)
          .json({ message: 'Invalid username or password' });
      }

      const passwordMatches = await bcrypt.compare(
        password,
        playerDoc.password,
      );
      if (!passwordMatches) {
        return res
          .status(401)
          .json({ message: 'Invalid username or password' });
      }

      const ban = await getBan(username);
      if (ban && (!ban.until || Date.now() < ban.until)) {
        return res.status(403).json({
          message: `You are banned from this game.${ban.reason ? ` Reason: ${ban.reason}` : ''}${ban.until ? ` Until: ${new Date(ban.until).toLocaleString()}` : ''}`,
        });
      } else if (ban) {
        await unbanPlayer(username);
      }

      const { password: _pw, ...runtimePlayer } = playerDoc;
      const player = enrichPlayer(runtimePlayer);

      if (serverState.mode === 'maintenance' && player.access < Access.ADMIN) {
        return res.status(503).json({
          message: 'Server is under maintenance. Please try again later.',
        });
      }
      if (serverState.mode === 'gm_only' && player.access < Access.MOD) {
        return res
          .status(503)
          .json({ message: 'Server is currently restricted to GMs only.' });
      }

      const existingWs = playersWsMap.get(username);
      if (existingWs?.readyState === WebSocket.OPEN) {
        return res.status(409).json({
          message: 'This account is already logged in from another session.',
        });
      }

      req.session.username = username;
      req.session.accessLevel = player.access ?? Access.USER;
      req.session.assetKey = crypto.randomBytes(32).toString('hex');

      if (!getPlayerById(player.id)) {
        registerPlayer(runtimePlayer);
      }

      const map = addPlayerOnMap(player.id);
      emit('playerJoin', { player: runtimePlayer });

      const mapMeta = map ? toMapMeta(map) : null;
      req.session.save((err) => {
        if (err) {
          logger.error('Session save failed', { err });
          return res.status(500).json({ message: 'Failed to save session' });
        }
        res.status(200).json({
          player,
          map: mapMeta,
          assetKey: req.session.assetKey,
          ...(serverState.motd ? { motd: serverState.motd } : {}),
        });
      });
    },
  );

  router.post('/logout', (req: ExtendedRequest, res: Response) => {
    const username = req.session.username;

    req.session.destroy((err) => {
      if (err) {
        logger.error('Session destroy failed', { err });
        res.status(500).send('Failed to destroy session');
        return;
      }
      disconnectPlayer(username).catch((e) => {
        logger.error('disconnectPlayer failed', { err: e });
      });
      res.status(200).send('Logged out');
    });
  });

  router.post(
    '/register',
    authLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(RegisterBodySchema, req.body, res);
      if (!body) return;
      const { username, password } = body;

      const existing = await getPlayerByNameFromDb(username);
      if (existing)
        return res.status(409).json({ message: 'Username already taken' });

      try {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const newPlayer = await createPlayer(username, hashedPassword);

        res.status(201).json({ success: true, playerId: newPlayer.id });
      } catch (err) {
        // Mongo's duplicate-key code: the unique index caught a racing signup
        // that the existence check above could not see.
        if ((err as { code?: number })?.code === 11000) {
          return res.status(409).json({ message: 'Username already taken' });
        }
        logger.error('Registration failed', { err });
        res
          .status(500)
          .json({ message: 'Registration failed, please try again' });
      }
    },
  );

  // What the login screen may offer. Asked before anyone is logged in, so it
  // says nothing about who exists, only what this deployment can do.
  router.get('/auth/capabilities', (_req: ExtendedRequest, res: Response) => {
    res.json({ passwordReset: mailReachesPlayers() });
  });

  // Changing a password you know. The session says who, so there is no username
  // in the body to disagree with it.
  router.post('/password', async (req: ExtendedRequest, res: Response) => {
    const username = req.session.username;
    if (!username) return res.status(401).json({ message: 'Not logged in' });

    const body = parseBody(ChangePasswordBodySchema, req.body, res);
    if (!body) return;

    const result = await changePassword(
      username,
      body.currentPassword,
      body.newPassword,
    );
    if (result === 'wrong-password') {
      return res.status(403).json({ message: 'Current password is wrong' });
    }
    if (result === 'no-account') {
      return res.status(404).json({ message: 'No such account' });
    }
    res.json({ success: true });
  });

  // Asking for a link. The answer never varies: a different reply for a name
  // that exists turns this into a way to enumerate accounts, and the rate limit
  // in front of it is the login one because the cost of abuse is the same.
  router.post(
    '/password/reset',
    authLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(ResetRequestBodySchema, req.body, res);
      if (!body) return;

      const minted = await createResetToken(body.username);
      if (minted) {
        await sendMail({
          to: minted.username,
          subject: 'Reset your password',
          text:
            `Open this link to choose a new password:\n\n` +
            `${resetLink(minted.token)}\n\n` +
            `It stops working at ${minted.expiresAt.toISOString()}, and once used.`,
        });
      }
      res.json({ success: true });
    },
  );

  // Spending it. Wrong or expired reads the same either way: which of the two
  // it was is only useful to somebody guessing.
  router.post(
    '/password/reset/confirm',
    authLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(ResetConfirmBodySchema, req.body, res);
      if (!body) return;

      const result = await consumeResetToken(body.token, body.newPassword);
      if (result === 'invalid-token') {
        return res
          .status(400)
          .json({ message: 'That link is no longer valid' });
      }
      res.json({ success: true });
    },
  );

  return router;
}
