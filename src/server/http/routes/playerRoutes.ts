import { type Request, type Response } from 'express';
import { WebSocket } from 'ws';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import { parseBody, AssignPointsBodySchema } from '../bodySchemas.js';
import checkAccess from '../middleware/checkAccess.js';
import { updatePlayer } from '../../services/world/gameData.js';
import { getPlayerById } from '../../services/player/playerService.js';
import { playersWsMap } from '../../net/connections.js';
import { gameConfig } from '../../gameConfig.js';
import { createRouter } from '../../app.js';

// What a player asks about themselves and about who else is here. Gameplay
// writes, not content: nothing on this router changes a definition, so none of
// it regenerates script constants.
export function createPlayerRouter() {
  const router = createRouter();

  router.get(
    '/players/online',
    checkAccess(Access.USER),
    (_: Request, res: Response) => {
      const players = Array.from(playersWsMap.entries())
        .filter(([, ws]) => ws.readyState === WebSocket.OPEN)
        .map(([username]) => username)
        .sort((a, b) => a.localeCompare(b));

      res.status(200).json({
        players,
        count: players.length,
      });
    },
  );

  router.post(
    '/players/:id/assignPoints',
    checkAccess(Access.USER),
    async (req: ExtendedRequest, res: Response) => {
      const body = parseBody(AssignPointsBodySchema, req.body, res);
      if (!body) return;
      const { vitality, attack, strength, defense, agility } = body;

      const totalAssigned = vitality + attack + strength + defense + agility;
      if (totalAssigned === 0) {
        return res.status(400).json({ error: 'No points assigned' });
      }

      const player = await getPlayerById(req.params['id']!);
      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }

      const isSelf = req.session.username === player.name;
      const isAdmin = (req.session.accessLevel ?? Access.USER) >= Access.ADMIN;

      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (totalAssigned > player.unspentPoints) {
        return res.status(400).json({ error: 'Not enough unspent points' });
      }

      player.vitality += vitality;
      player.attack += attack;
      player.strength += strength;
      player.defense += defense;
      player.agility += agility;
      player.unspentPoints -= totalAssigned;

      player.maxHealth =
        gameConfig.player.startingMaxHealth + player.vitality * 10;

      updatePlayer(player);

      return res.json({
        success: true,
        unspentPoints: player.unspentPoints,
        vitality: player.vitality,
        attack: player.attack,
        strength: player.strength,
        defense: player.defense,
        agility: player.agility,
        maxHealth: player.maxHealth,
      });
    },
  );

  return router;
}
