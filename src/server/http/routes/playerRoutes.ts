import { Router } from 'express';
import { WebSocket } from 'ws';
import { Access } from '../../../shared/types.js';
import { parseBody, AssignPointsBodySchema } from '../bodySchemas.js';
import checkAccess from '../middleware/checkAccess.js';
import {
  getPlayerById as getLivePlayer,
  updatePlayer,
} from '../../sim/world.js';
import {
  addStatsOffline,
  getPlayerById,
} from '../../services/player/playerService.js';
import { playersWsMap } from '../../net/connections.js';
import { listOnlineEverywhere } from '../../persistence/presence.js';
import { registerStrings, translateFor } from '../../engine/i18n.js';

registerStrings({
  pt: {
    'No points assigned': 'Nenhum ponto distribuído',
    'Not enough unspent points': 'Não há pontos livres suficientes',
    'That character is playing on another server':
      'Esse personagem está jogando em outro servidor',
  },
  es: {
    'No points assigned': 'No se asignó ningún punto',
    'Not enough unspent points': 'No hay suficientes puntos sin gastar',
    'That character is playing on another server':
      'Ese personaje está jugando en otro servidor',
  },
});

// What a player asks about themselves and about who else is here. Gameplay
// writes, not content: nothing on this router changes a definition, so none of
// it regenerates script constants.
export function createPlayerRouter() {
  const router = Router();

  router.get('/players/online', checkAccess(Access.USER), async (_, res) => {
    // Across the fleet when there is one: a player who cannot see half the
    // server in this list cannot tell that half exists.
    const players = (
      (await listOnlineEverywhere()) ??
      Array.from(playersWsMap.entries())
        .filter(([, ws]) => ws.readyState === WebSocket.OPEN)
        .map(([username]) => username)
    ).sort((a, b) => a.localeCompare(b));

    res.status(200).json({
      players,
      count: players.length,
    });
  });

  router.post(
    '/players/:id/assignPoints',
    checkAccess(Access.USER),
    async (req, res) => {
      const body = parseBody(AssignPointsBodySchema, req.body, res);
      if (!body) return;
      const { vitality, attack, strength, defense, agility } = body;

      const totalAssigned = vitality + attack + strength + defense + agility;
      if (totalAssigned === 0) {
        return res
          .status(400)
          .json({ error: translateFor(req, 'No points assigned') });
      }

      // The character in the world when there is one, and never a copy read
      // from the database: the document trails the world by a snapshot, and
      // writing a copy back would undo everything played since.
      const id = req.params['id'];
      const live = getLivePlayer(id);
      const player = live ?? (await getPlayerById(id));
      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }

      const isSelf = req.session.username === player.name;
      const isAdmin = (req.session.accessLevel ?? Access.USER) >= Access.ADMIN;

      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (totalAssigned > player.unspentPoints) {
        return res
          .status(400)
          .json({ error: translateFor(req, 'Not enough unspent points') });
      }

      const gains = {
        vitality,
        attack,
        strength,
        defense,
        agility,
        // Added to the ceiling the player has, which is not only vitality's: a
        // GM, a script or the seed can set it too, and a recomputed one would
        // throw that away on the first point spent.
        maxHealth: vitality * 10,
        unspentPoints: -totalAssigned,
      };

      if (live) {
        for (const [stat, gain] of Object.entries(gains)) {
          live[stat as keyof typeof gains] += gain;
        }
        updatePlayer(live);
      }
      const result = live ?? (await addStatsOffline(id, gains));
      if (!result) {
        // In the world on another instance, the only one that may change it,
        // as the shop's buy route also holds.
        return res.status(409).json({
          error: translateFor(
            req,
            'That character is playing on another server',
          ),
        });
      }

      return res.json({
        success: true,
        unspentPoints: result.unspentPoints,
        vitality: result.vitality,
        attack: result.attack,
        strength: result.strength,
        defense: result.defense,
        agility: result.agility,
        maxHealth: result.maxHealth,
      });
    },
  );

  return router;
}
