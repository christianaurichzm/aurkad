import { type Request, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import type { PlayerServer } from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import {
  parseBody,
  PlayerNameBodySchema,
  ChangeSpriteBodySchema,
  BanBodySchema,
  SetSpriteBodySchema,
  SetAccessBodySchema,
  GoMapBodySchema,
  SetMyAccessBodySchema,
  WarpPlayerBodySchema,
} from '../bodySchemas.js';
import { getMap } from '../../services/world/gameData.js';
import checkAccess from '../middleware/checkAccess.js';
import { broadcast } from '../../net/index.js';
import { teleportPlayer } from '../../services/world/movementService.js';
import { banPlayer } from '../../services/player/banService.js';
import {
  getPlayerByName,
  changeSprite,
  handlePlayerUpdates,
  kickPlayer,
  setAccess,
  saveAccess,
} from '../../services/player/playerService.js';
import { createRouter } from '../../app.js';

/**
 * The operator's own live character, or null with the reason already sent.
 * bring, goto, gomap and setMyAccess need the operator in the world, and an
 * admin dashboard session never is, so the refusal says that rather than
 * "Player not found", which would read as a mistyped target.
 */
function requireSelfInWorld(
  req: ExtendedRequest,
  res: Response,
): PlayerServer | null {
  const me = getPlayerByName(req.session.username!);
  if (me) return me;
  res
    .status(409)
    .send('You must be in the game world to use this. Open the game first.');
  return null;
}

export function createModRouter() {
  const router = createRouter();

  router.post(
    '/mod/changeSprite',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      const body = parseBody(ChangeSpriteBodySchema, req.body, res);
      if (!body) return;
      if (req.session.username) {
        changeSprite(body.spriteId, req.session.username);
        res.status(200).send('Sucess');
      }
    },
  );

  router.post(
    '/mod/kick',
    checkAccess(Access.MOD),
    async (req: Request, res: Response) => {
      const body = parseBody(PlayerNameBodySchema, req.body, res);
      if (!body) return;
      const { playerName } = body;
      const player = getPlayerByName(playerName);

      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }

      await kickPlayer(
        playerName,
        'You were kicked from the game by a moderator.',
      );
      res.status(200).json({ success: true });
    },
  );

  router.post(
    '/mod/ban',
    checkAccess(Access.ADMIN),
    async (req: Request, res: Response) => {
      const body = parseBody(BanBodySchema, req.body, res);
      if (!body) return;
      const { playerName, reason, until } = body;
      await banPlayer(playerName, reason, until);
      await kickPlayer(
        playerName,
        reason
          ? `You were banned: ${reason}`
          : 'You were banned from the game.',
      );
      res.status(200).json({ success: true });
    },
  );

  router.post(
    '/mod/bring',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      const body = parseBody(PlayerNameBodySchema, req.body, res);
      if (!body) return;
      const { playerName } = body;
      const me = requireSelfInWorld(req, res);
      if (!me) return;
      const target = getPlayerByName(playerName);
      if (!target) return res.status(404).send('Player not found');

      // Beside the operator, not on top of them: placement keeps two players
      // off one tile.
      teleportPlayer(target, me.mapId, { ...me.position });
      broadcast();

      res.status(200).send('Player brought to you');
    },
  );

  router.post(
    '/mod/goto',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      const body = parseBody(PlayerNameBodySchema, req.body, res);
      if (!body) return;
      const { playerName } = body;
      const me = requireSelfInWorld(req, res);
      if (!me) return;
      const target = getPlayerByName(playerName);
      if (!target) return res.status(404).send('Player not found');

      teleportPlayer(me, target.mapId, { ...target.position });
      broadcast();

      res.status(200).send('Teleported to player');
    },
  );

  router.post(
    '/mod/warp',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      const body = parseBody(WarpPlayerBodySchema, req.body, res);
      if (!body) return;
      const { playerName, mapId, col, row } = body;
      const target = getPlayerByName(playerName);
      if (!target) return res.status(404).send('Player not found');
      if (!getMap(mapId)) return res.status(400).send('Map not loaded');

      teleportPlayer(target, mapId, { x: col * TILE_SIZE, y: row * TILE_SIZE });
      broadcast();

      res.status(200).send('Player warped');
    },
  );

  router.post(
    '/mod/setSprite',
    checkAccess(Access.MOD),
    (req: Request, res: Response) => {
      const body = parseBody(SetSpriteBodySchema, req.body, res);
      if (!body) return;
      const { playerName, spriteId } = body;
      const target = getPlayerByName(playerName);
      if (!target) return res.status(404).send('Player not found');

      target.sprite = spriteId;
      handlePlayerUpdates(target);
      broadcast();

      res.status(200).send('Sprite updated');
    },
  );

  router.post(
    '/mod/setAccess',
    checkAccess(Access.ADMIN),
    async (req: Request, res: Response) => {
      const body = parseBody(SetAccessBodySchema, req.body, res);
      if (!body) return;
      const { playerName, accessLevel } = body;
      const target = getPlayerByName(playerName);
      if (!target) return res.status(404).send('Player not found');

      setAccess(target, accessLevel);
      handlePlayerUpdates(target);
      await saveAccess(playerName, accessLevel);
      broadcast();

      res.status(200).send('Access updated');
    },
  );

  router.post(
    '/mod/gomap',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      const body = parseBody(GoMapBodySchema, req.body, res);
      if (!body) return;
      const { mapId } = body;
      const me = requireSelfInWorld(req, res);
      if (!me) return;

      teleportPlayer(me, mapId, { x: 9 * TILE_SIZE, y: 6 * TILE_SIZE });
      broadcast();

      res.status(200).send('Moved to map');
    },
  );

  router.post(
    '/mod/setMyAccess',
    checkAccess(Access.ADMIN),
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(SetMyAccessBodySchema, req.body, res);
      if (!body) return;
      const { accessLevel } = body;
      const me = requireSelfInWorld(req, res);
      if (!me) return;

      setAccess(me, accessLevel);
      handlePlayerUpdates(me);
      await saveAccess(me.name, accessLevel);
      broadcast();

      res.status(200).send('Your access updated');
    },
  );

  return router;
}
