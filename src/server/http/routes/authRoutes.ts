import bcrypt from 'bcrypt';
import { Router, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { players } from '../../gameData.js';
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

export function createAuthRouter() {
  const router = Router();

  router.post('/login', async (req: ExtendedRequest, res: Response) => {
    const { username, password } = req.body ?? {};

    if (!username || !password) {
      return res.status(400).send('Username and password are required');
    }

    const playerDoc = await getPlayerByNameFromDb(username);
    if (!playerDoc) {
      return res.status(404).send('User not found');
    }

    const passwordMatches = await bcrypt.compare(password, playerDoc.password);
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

    if (!players[player.id]) {
      players[player.id] = runtimePlayer;
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
        console.error('Session save failed:', err);
        return res.status(500).send('Failed to save session');
      }
      res.status(200).json({ player, map: mapClient });
    });
  });

  router.post('/logout', (req: ExtendedRequest, res: Response) => {
    const username = req.session.username;

    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy failed:', err);
        res.status(500).send('Failed to destroy session');
        return;
      }
      disconnectPlayer(username).catch((e) => {
        console.error('disconnectPlayer failed:', e);
      });
      res.status(200).send('Logged out');
    });
  });

  router.post('/register', async (req: ExtendedRequest, res: Response) => {
    const { username, password } = req.body ?? {};

    if (!username || !password) {
      return res.status(400).send('Username and password are required');
    }

    const existing = await getPlayerByNameFromDb(username);
    if (existing) return res.status(409).send('Username already taken');

    try {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const newPlayer = await createPlayer(username, hashedPassword);

      res.status(201).json({ success: true, playerId: newPlayer.id });
    } catch (err) {
      console.error('Registration failed:', err);
      res.status(500).send('Failed to register player');
    }
  });

  return router;
}
