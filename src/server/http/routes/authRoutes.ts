import crypto from 'node:crypto';
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
  SetEmailBodySchema,
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
  confirmEmailToken,
  consumeResetToken,
  createEmailToken,
  createResetToken,
  emailConfirmLink,
  resetLink,
} from '../../services/player/passwordService.js';
import {
  mailReachesPlayers,
  sendMail,
} from '../../services/comms/mailService.js';
import { checkSecondFactor } from '../../services/player/twoFactorService.js';
import {
  acquirePresence,
  releasePresence,
} from '../../persistence/presence.js';

/** Matches the session store's TTL in http/session.ts. */
const REMEMBERED_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

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

      // Before anything about the world: the same password opens a game
      // session with the access level every in-game operator command reads,
      // and a factor guarding one door and not the other guards nothing.
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

      const ban = await getBan(username);
      if (ban && (!ban.until || Date.now() < ban.until)) {
        return res.status(403).json({
          message: `You are banned from this game.${ban.reason ? ` Reason: ${ban.reason}` : ''}${ban.until ? ` Until: ${new Date(ban.until).toLocaleString()}` : ''}`,
        });
      } else if (ban) {
        await unbanPlayer(username);
      }

      // Only now, with the password checked and the ban cleared: a cookie that
      // outlives the browser is worth having only for a session that exists.
      // The week matches the store's own TTL, so the row and the cookie expire
      // together instead of one outliving the other.
      if (body.remember) {
        req.session.cookie.maxAge = REMEMBERED_SESSION_MS;
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

      // The socket above is this process only; the lease asks every
      // instance. Whoever holds it may write this character, so a second
      // session elsewhere would lose its progress to the first one's flush.
      const presence = await acquirePresence(player.id, username);
      if (!presence.ok) {
        logger.warn('[presence] login refused, account held elsewhere', {
          player: username,
          owner: presence.owner,
        });
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
          // The lease was taken for a session that does not exist: held, it
          // would keep this account out of every instance until it expired.
          void releasePresence(player.id);
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

  // What the screens may offer. Asked before login, so it says nothing about
  // who exists, only what this deployment can do. One fact, mail reaching a
  // player, gates both offering a reset link and asking for an address.
  router.get('/auth/capabilities', (_req: ExtendedRequest, res: Response) => {
    res.json({ mail: mailReachesPlayers() });
  });

  // The address on the account, for the screen that sets it. Null covers both
  // "never set" and "set but never confirmed": until a link comes back there is
  // no address, and saying otherwise would promise delivery to a typo.
  router.get('/email', async (req: ExtendedRequest, res: Response) => {
    const username = req.session.username;
    if (!username) return res.status(401).json({ message: 'Not logged in' });

    const record = await getPlayerByNameFromDb(username);
    res.json({ email: record?.email ?? null });
  });

  // Pointing the account at an address. Rate limited with the login bucket
  // because it sends mail on request, and a mailbox somebody else owns is the
  // thing being written to.
  router.post(
    '/email',
    authLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const username = req.session.username;
      if (!username) return res.status(401).json({ message: 'Not logged in' });

      const body = parseBody(SetEmailBodySchema, req.body, res);
      if (!body) return;

      const record = await getPlayerByNameFromDb(username);
      if (!record) return res.status(404).json({ message: 'No such account' });
      if (!(await bcrypt.compare(body.currentPassword, record.password))) {
        return res.status(403).json({ message: 'Current password is wrong' });
      }

      const { token } = await createEmailToken(record.name, body.email);
      const sent = await sendMail({
        to: body.email,
        subject: 'Confirm your address',
        text:
          `Open this link to use this address for ${record.name}:\n\n` +
          `${emailConfirmLink(token)}\n\n` +
          `It stops working in 30 minutes, and once used.`,
      });
      // The address is not stored yet, so a failed send leaves only a token
      // nobody can spend, and the screen says to try again.
      res.json({ success: true, sent });
    },
  );

  // Spending an address link. A GET because it is what a mail client opens,
  // and the token is the whole proof; the reply is read in a browser tab that
  // the player then closes, so it is a sentence rather than a screen.
  router.get('/email/confirm', async (req: ExtendedRequest, res: Response) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const result = token ? await confirmEmailToken(token) : 'invalid-token';
    res.type('text/plain');
    if (result === 'invalid-token') {
      return res.status(400).send('That link is no longer valid.');
    }
    res.send('Address confirmed. You can close this tab.');
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
      // No address means no way to deliver it. The token is minted either way
      // so this path costs the same for an account that has one and one that
      // does not, and the operator's `resetlink` still reaches anybody.
      if (minted?.email) {
        await sendMail({
          to: minted.email,
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
