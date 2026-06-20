import { Router, type Request, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access, CharacterAction } from '../../../shared/types.js';
import {
  parseBody,
  PlayerNameBodySchema,
  ChangeSpriteBodySchema,
  BanBodySchema,
  SetSpriteBodySchema,
  SetAccessBodySchema,
  GoMapBodySchema,
  SetMyAccessBodySchema,
} from '../bodySchemas.js';
import checkAccess from '../middleware/checkAccess.js';
import { broadcast } from '../../net/index.js';
import {
  kickPlayer,
  handlePlayerUpdate,
} from '../../services/gameService.js';
import { updatePlayerMap } from '../../services/mapService.js';
import { banPlayer } from '../../services/banService.js';
import { getPlayerByName, changeSprite } from '../../services/playerService.js';

export function createModRouter() {
  const router = Router();

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

      await kickPlayer(playerName, 'You were kicked from the game by a moderator.');
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
      banPlayer(playerName, reason, until);
      await kickPlayer(
        playerName,
        reason ? `You were banned: ${reason}` : 'You were banned from the game.',
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
      const me = getPlayerByName(req.session.username!);
      const target = getPlayerByName(playerName);

      if (!me || !target) return res.status(404).send('Player not found');

      const previousMapId = target.mapId;
      target.position = { ...me.position };
      target.mapId = me.mapId;
      target.targetPosition = undefined;
      target.moving = false;
      target.action = CharacterAction.Idle;
      target.moveTick = undefined;
      target.moveDurationTicks = undefined;

      updatePlayerMap(target.id, target, previousMapId);
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
      const me = getPlayerByName(req.session.username!);
      const target = getPlayerByName(playerName);

      if (!me || !target) return res.status(404).send('Player not found');

      const previousMapId = me.mapId;
      me.position = { ...target.position };
      me.mapId = target.mapId;
      me.targetPosition = undefined;
      me.moving = false;
      me.action = CharacterAction.Idle;
      me.moveTick = undefined;
      me.moveDurationTicks = undefined;

      updatePlayerMap(me.id, me, previousMapId);
      broadcast();

      res.status(200).send('Teleported to player');
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
      handlePlayerUpdate(target);
      broadcast();

      res.status(200).send('Sprite updated');
    },
  );

  router.post(
    '/mod/setAccess',
    checkAccess(Access.ADMIN),
    (req: Request, res: Response) => {
      const body = parseBody(SetAccessBodySchema, req.body, res);
      if (!body) return;
      const { playerName, accessLevel } = body;
      const target = getPlayerByName(playerName);
      if (!target) return res.status(404).send('Player not found');

      target.access = accessLevel;
      handlePlayerUpdate(target);
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
      const me = getPlayerByName(req.session.username!);
      if (!me) return res.status(404).send('Player not found');

      const previousMapId = me.mapId;
      me.mapId = mapId;
      me.position = { x: 9 * 64, y: 6 * 64 };
      me.targetPosition = undefined;
      me.moving = false;
      me.action = CharacterAction.Idle;
      me.moveTick = undefined;
      me.moveDurationTicks = undefined;

      updatePlayerMap(me.id, me, previousMapId);
      broadcast();

      res.status(200).send('Moved to map');
    },
  );

  router.post(
    '/mod/setMyAccess',
    checkAccess(Access.ADMIN),
    (req: ExtendedRequest, res: Response) => {
      const body = parseBody(SetMyAccessBodySchema, req.body, res);
      if (!body) return;
      const { accessLevel } = body;
      const me = getPlayerByName(req.session.username!);
      if (!me) return res.status(404).send('Player not found');

      me.access = accessLevel;
      handlePlayerUpdate(me);
      req.session.accessLevel = accessLevel;
      req.session.save(() => {});
      broadcast();

      res.status(200).send('Your access updated');
    },
  );

  return router;
}
