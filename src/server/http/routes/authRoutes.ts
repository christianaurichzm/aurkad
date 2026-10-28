import bcrypt from 'bcrypt';
import { Router, type Response } from 'express';
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
import {
  createPlayer,
  disconnectPlayer,
  enterWorld,
  getPlayerByNameFromDb,
  getPlayerForAuthentication,
  inAccountTurn,
  nameTaken,
  refuseEntry,
} from '../../services/player/playerService.js';
import { enrichPlayer } from '../../net/serialization.js';
import { toMapMeta } from '../../net/serialization.js';
import { getMapById, ownsMap } from '../../services/world/mapService.js';
import { serverState } from '../../services/serverState.js';
import { playersWsMap } from '../../net/connections.js';
import { WebSocket } from 'ws';
import { createAuthLimiter } from '../middleware/rateLimit.js';
import {
  registerStrings,
  requestLanguage,
  translateFor,
} from '../../engine/i18n.js';
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

// What a player reads from these routes, in the language their page asked in.
registerStrings({
  pt: {
    'Invalid username or password': 'Usuário ou senha inválidos',
    'This account needs its authentication code.':
      'Esta conta precisa do código de autenticação.',
    'That code is wrong or already used.':
      'Esse código está errado ou já foi usado.',
    'This account is already logged in from another session.':
      'Esta conta já está conectada em outra sessão.',
    'Username already taken': 'Esse nome de usuário já está em uso',
    'Not logged in': 'Você não está conectado',
    'No such account': 'Essa conta não existe',
    'Current password is wrong': 'A senha atual está errada',
    'That link is no longer valid': 'Esse link não vale mais',
    'That link is no longer valid.': 'Esse link não vale mais.',
    'Address confirmed. You can close this tab.':
      'Endereço confirmado. Pode fechar esta aba.',
  },
});

/** Matches the session store's TTL in http/session.ts. */
const REMEMBERED_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function createAuthRouter() {
  const router = Router();
  const authLimiter = createAuthLimiter();

  router.post(
    '/login',
    authLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(LoginBodySchema, req.body, res);
      if (!body) return;
      const { username, password } = body;

      const playerDoc = await getPlayerForAuthentication(username);
      if (!playerDoc) {
        return res
          .status(401)
          .json({ message: translateFor(req, 'Invalid username or password') });
      }

      const passwordMatches = await bcrypt.compare(
        password,
        playerDoc.password,
      );
      if (!passwordMatches) {
        return res
          .status(401)
          .json({ message: translateFor(req, 'Invalid username or password') });
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
              ? translateFor(req, 'This account needs its authentication code.')
              : translateFor(req, 'That code is wrong or already used.'),
        });
      }

      // From the refusals to the world, one login, socket or departure of
      // this account at a time (inAccountTurn).
      return inAccountTurn(playerDoc.id, async () => {
        const refused = await refuseEntry(playerDoc, requestLanguage(req));
        if (refused) {
          return res.status(refused.status).json({ message: refused.message });
        }

        const { authEpoch = 0 } = playerDoc;

        const existingWs = playersWsMap.get(username);
        if (existingWs?.readyState === WebSocket.OPEN) {
          return res.status(409).json({
            message: translateFor(
              req,
              'This account is already logged in from another session.',
            ),
          });
        }

        // A character saved on a map another instance runs enters no map here:
        // the socket the client opens next is what sends it there. The client
        // opens that socket only once it has a map to open the game on, so the
        // answer carries this one's outline, read before anything is held.
        const awayMap = ownsMap(playerDoc.mapId)
          ? null
          : await getMapById(playerDoc.mapId);

        // The socket above is this process only; the lease asks every
        // instance. Whoever holds it may write this character, so a second
        // session elsewhere would lose its progress to the first one's flush.
        const presence = await acquirePresence(playerDoc.id, username);
        if (!presence.ok) {
          logger.warn('[presence] login refused, account held elsewhere', {
            player: username,
            owner: presence.owner,
          });
          return res.status(409).json({
            message: translateFor(
              req,
              'This account is already logged in from another session.',
            ),
          });
        }

        // Read again under the lease: the instance that let go of it wrote its
        // last save on the way out, and that can land after the read the
        // password was checked against. Credentials and privileges must still
        // belong to the generation read then, before bcrypt and the second
        // factor, both of which yield to revocation.
        const current = await getPlayerForAuthentication(username);
        if (current?.authEpoch !== authEpoch) {
          if (presence.fresh) await releasePresence(playerDoc.id);
          return res.status(401).json({
            message: translateFor(req, 'Invalid username or password'),
          });
        }
        const { password: _pw, authEpoch: _epoch, ...character } = current;
        const player = enrichPlayer(character);

        // A new session, not the request's: a cookie planted beforehand (a
        // sibling subdomain, plain http) is someone else's, and signing in on it
        // signs them in too. Saved before the character enters the world, so a
        // failure answers 500 and lets go of the lease with nobody left inside.
        const saveError = await new Promise<unknown>((resolve) =>
          req.session.regenerate((err) => {
            if (err) return resolve(err);
            // A cookie that outlives the browser, only for a session that
            // exists. The week matches the store's own TTL, so the row and the
            // cookie expire together instead of one outliving the other.
            if (body.remember) {
              req.session.cookie.maxAge = REMEMBERED_SESSION_MS;
            }
            req.session.username = username;
            req.session.accessLevel = player.access ?? Access.USER;
            req.session.authEpoch = authEpoch;
            req.session.save(resolve);
          }),
        );
        if (saveError) {
          logger.error('Session save failed', { err: saveError });
          // The lease was taken for a session that does not exist: held, it
          // would keep this account out of every instance until it expired.
          // Caught, as a rejection left loose ends the process.
          if (presence.fresh) {
            void releasePresence(player.id).catch((err) =>
              logger.error('[presence] release after a failed login failed', {
                player: username,
                err,
              }),
            );
          }
          return res.status(500).json({ message: 'Failed to save session' });
        }

        const map = enterWorld(character) ?? awayMap;
        res.status(200).json({
          player,
          map: map ? toMapMeta(map) : null,
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
      // The game socket outlives the session it was opened under: left open,
      // it holds a character that has left the world, and the next login is
      // turned away as a second session.
      if (username) playersWsMap.get(username)?.close(1000, 'Logged out');
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
      // The first rule broken, as the sentence the form shows. The form checks
      // the same game.json rules before sending, so this is mostly read by a
      // client that does not.
      const parsed = RegisterBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: translateFor(req, parsed.error.issues[0]!.message),
        });
      }
      const { username, password } = parsed.data;

      if (await nameTaken(username))
        return res
          .status(409)
          .json({ message: translateFor(req, 'Username already taken') });

      try {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const newPlayer = await createPlayer(username, hashedPassword);

        res.status(201).json({ success: true, playerId: newPlayer.id });
      } catch (err) {
        // Mongo's duplicate-key code: the unique index caught a racing signup
        // that the existence check above could not see.
        if ((err as { code?: number })?.code === 11000) {
          return res
            .status(409)
            .json({ message: translateFor(req, 'Username already taken') });
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
    if (!username)
      return res
        .status(401)
        .json({ message: translateFor(req, 'Not logged in') });

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
      if (!username)
        return res
          .status(401)
          .json({ message: translateFor(req, 'Not logged in') });

      const body = parseBody(SetEmailBodySchema, req.body, res);
      if (!body) return;

      // Read with the generation, so the link is bound to the password that
      // was checked rather than to whatever is current once the hash returns.
      const record = await getPlayerForAuthentication(username);
      if (!record)
        return res
          .status(404)
          .json({ message: translateFor(req, 'No such account') });
      if (!(await bcrypt.compare(body.currentPassword, record.password))) {
        return res
          .status(403)
          .json({ message: translateFor(req, 'Current password is wrong') });
      }

      const { token } = await createEmailToken(
        record.name,
        body.email,
        record.authEpoch ?? 0,
      );
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
      return res
        .status(400)
        .send(translateFor(req, 'That link is no longer valid.'));
    }
    res.send(translateFor(req, 'Address confirmed. You can close this tab.'));
  });

  // Changing a password you know. The session says who, so there is no
  // username in the body to disagree with it. Behind the login bucket because
  // the current password is a guess here too: a session left open is not the
  // password, and at the general limit it would be a few hundred tries a
  // minute at it.
  router.post(
    '/password',
    authLimiter,
    async (req: ExtendedRequest, res: Response) => {
      const username = req.session.username;
      if (!username)
        return res
          .status(401)
          .json({ message: translateFor(req, 'Not logged in') });

      const body = parseBody(ChangePasswordBodySchema, req.body, res);
      if (!body) return;

      const result = await changePassword(
        username,
        body.currentPassword,
        body.newPassword,
      );
      if (result === 'wrong-password') {
        return res
          .status(403)
          .json({ message: translateFor(req, 'Current password is wrong') });
      }
      if (result === 'no-account') {
        return res
          .status(404)
          .json({ message: translateFor(req, 'No such account') });
      }
      res.json({ success: true });
    },
  );

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
          .json({ message: translateFor(req, 'That link is no longer valid') });
      }
      res.json({ success: true });
    },
  );

  return router;
}
