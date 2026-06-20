import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import {
  parseBody,
  LoginBodySchema,
  RegisterBodySchema,
} from '../bodySchemas.js';
import { logger } from '../../logger.js';
import { getPlayerById, registerPlayer } from '../../sim/world.js';
import { addPlayerOnMap } from '../../services/mapService.js';
import { disconnectPlayer } from '../../services/gameService.js';
import {
  createPlayer,
  enrichPlayer,
  getPlayerByNameFromDb,
} from '../../services/playerService.js';
import { getBan, unbanPlayer } from '../../services/banService.js';
import { config } from '../../config.js';
import { toMapStateClient } from '../../engine/serialization.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

export function createAuthRouter() {
  const router = Router();

  router.post(
    '/login',
    authLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(LoginBodySchema, req.body, res);
      if (!body) return;
      const { username, password } = body;

      const playerDoc = await getPlayerByNameFromDb(username);
      if (!playerDoc) {
        return res.status(404).send('User not found');
      }

      const passwordMatches = await bcrypt.compare(
        password,
        playerDoc.password,
      );
      if (!passwordMatches) {
        return res.status(401).send('Invalid password');
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

      req.session.username = username;
      req.session.accessLevel = player.access ?? Access.USER;
      req.session.assetKey = crypto.randomBytes(32).toString('hex');

      if (!getPlayerById(player.id)) {
        registerPlayer(runtimePlayer);
      }

      const map = addPlayerOnMap(player.id);

      const mapClient =
        map &&
        toMapStateClient(
          map,
          runtimePlayer,
          config.net.interestRadiusTiles * TILE_SIZE,
        );
      req.session.save((err) => {
        if (err) {
          logger.error('Session save failed', { err });
          return res.status(500).send('Failed to save session');
        }
        res
          .status(200)
          .json({ player, map: mapClient, assetKey: req.session.assetKey });
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
      if (existing) return res.status(409).send('Username already taken');

      try {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const newPlayer = await createPlayer(username, hashedPassword);

        res.status(201).json({ success: true, playerId: newPlayer.id });
      } catch (err) {
        logger.error('Registration failed', { err });
        res.status(500).send('Failed to register player');
      }
    },
  );

  return router;
}
