import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import {
  parseBody,
  LoginBodySchema,
  RegisterBodySchema,
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
      } catch (err: any) {
        if (err?.code === 11000) {
          return res.status(409).json({ message: 'Username already taken' });
        }
        logger.error('Registration failed', { err });
        res
          .status(500)
          .json({ message: 'Registration failed, please try again' });
      }
    },
  );

  return router;
}
