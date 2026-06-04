import { Router, type Request, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access, CharacterAction } from '../../../shared/types.js';
import checkAccess from '../../checkAccess.js';
import { playersWsMap, broadcast } from '../../wsServer.js';
import {
  disconnectPlayer,
  handlePlayerUpdate,
} from '../../services/gameService.js';
import {
  updatePlayerMap,
} from '../../services/mapService.js';
import { banPlayer } from '../../services/banService.js';
import { getPlayerByName, changeSprite } from '../../services/playerService.js';

export function createModRouter() {
  const router = Router();

  router.post(
    '/mod/changeSprite',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      if (req.session.username) {
        changeSprite(req.body.spriteId, req.session.username);
        res.status(200).send('Sucess');
      }
    },
  );

  router.post(
    '/mod/kick',
    checkAccess(Access.MOD),
    async (req: Request, res: Response) => {
      const { playerName } = req.body ?? {};
      const player = getPlayerByName(playerName);

      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }

      const ws = playersWsMap.get(playerName);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'kick',
            message: 'You were kicked from the game by a moderator.',
          }),
        );
        ws.close();
      }

      await disconnectPlayer(playerName);
      playersWsMap.delete(playerName);
      broadcast();

      res.status(200).json({ success: true });
    },
  );

  router.post(
    '/mod/ban',
    checkAccess(Access.ADMIN),
    async (req: Request, res: Response) => {
      const { playerName, reason, until } = req.body ?? {};
      if (!playerName) return res.status(400).json({ error: 'No player name' });
      banPlayer(playerName, reason, until);
      const ws = playersWsMap.get(playerName);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'kick',
            message: reason
              ? `You were banned: ${reason}`
              : 'You were banned from the game.',
          }),
        );
        ws.close();
      }
      await disconnectPlayer(playerName);
      playersWsMap.delete(playerName);
      broadcast();
      res.status(200).json({ success: true });
    },
  );

  router.post(
    '/mod/bring',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      const { playerName } = req.body ?? {};
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
      const { playerName } = req.body ?? {};
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
      const { playerName, spriteId } = req.body ?? {};
      const target = getPlayerByName(playerName);
      if (!target) return res.status(404).send('Player not found');

      target.sprite = Number(spriteId);
      handlePlayerUpdate(target);
      broadcast();

      res.status(200).send('Sprite updated');
    },
  );

  router.post(
    '/mod/setAccess',
    checkAccess(Access.ADMIN),
    (req: Request, res: Response) => {
      const { playerName, accessLevel } = req.body ?? {};
      const target = getPlayerByName(playerName);
      if (!target) return res.status(404).send('Player not found');

      target.access = accessLevel as Access;
      handlePlayerUpdate(target);
      broadcast();

      res.status(200).send('Access updated');
    },
  );

  router.post(
    '/mod/gomap',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      const { mapId } = req.body ?? {};
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
      const { accessLevel } = req.body ?? {};
      const me = getPlayerByName(req.session.username!);
      if (!me) return res.status(404).send('Player not found');

      me.access = accessLevel as Access;
      handlePlayerUpdate(me);
      req.session.accessLevel = accessLevel as Access;
      req.session.save(() => {});
      broadcast();

      res.status(200).send('Your access updated');
    },
  );

  return router;
}
