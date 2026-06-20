import {
  PlayerServer,
  Direction,
  MapStateServer,
  DroppedItem,
  CombatTarget,
} from '../../shared/types.js';
import { getMap, updatePlayer } from '../gameData.js';
import { logger } from '../logger.js';
import { getTick } from '../sim/clock.js';
import { randomChance } from '../sim/rng.js';
import { queryEntitiesInRadius } from '../spatial/SpatialManager.js';
import { tryConsumeAttackCooldown } from './combat/attackCooldown.js';
import { handleChatAction } from './chatService.js';
import { getItemById } from './inventoryService.js';
import { respawnNpc } from './npcService.js';
import { respawnPlayer, levelUpPlayer } from './playerService.js';

const isInAttackRange = (
  attacker: PlayerServer,
  target: CombatTarget,
): boolean => {
  const dx = Math.abs(attacker.position.x - target.position.x);
  const dy = Math.abs(attacker.position.y - target.position.y);

  const inLine =
    (dx === 0 && dy <= attacker.attackRange) ||
    (dy === 0 && dx <= attacker.attackRange);

  return inLine;
};

const isFacingTarget = (
  attacker: PlayerServer,
  target: CombatTarget,
): boolean => {
  switch (attacker.direction) {
    case Direction.Up:
      return target.position.y < attacker.position.y;
    case Direction.Down:
      return target.position.y > attacker.position.y;
    case Direction.Left:
      return target.position.x < attacker.position.x;
    case Direction.Right:
      return target.position.x > attacker.position.x;
    default:
      return false;
  }
};

const findAttackTarget = (
  attacker: PlayerServer,
  map: MapStateServer,
): CombatTarget | undefined => {
  const nearby = queryEntitiesInRadius(
    attacker.mapId,
    attacker.position.x,
    attacker.position.y,
    attacker.attackRange,
  );

  for (const entity of nearby) {
    if (!entity.id || entity.id === attacker.id) continue;

    const target: CombatTarget | undefined =
      (map.type === 'pvp' ? map.players[entity.id] : undefined) ??
      map.npcs[entity.id];

    if (!target || target.health <= 0) continue;
    if (target.kind === 'npc' && target.behavior === 'neutral') continue;
    if (!isInAttackRange(attacker, target)) continue;
    if (!isFacingTarget(attacker, target)) continue;

    return target;
  }

  return undefined;
};

export const handleAttack = async (attacker: PlayerServer): Promise<void> => {
  if (!attacker) return;

  if (!tryConsumeAttackCooldown(attacker.id, getTick())) return;

  const map = getMap(attacker.mapId);
  if (!map) return;

  const attackTarget: CombatTarget | undefined = findAttackTarget(
    attacker,
    map,
  );
  if (!attackTarget) return;

  if (attackTarget.kind === 'npc' && attackTarget.behavior === 'neutral')
    return;

  attackTarget.health -= attacker.attack;

  if (attackTarget.health > 0) return;

  attackTarget.health = 0;

  switch (attackTarget.kind) {
    case 'player':
      respawnPlayer(attackTarget);
      await updatePlayer(attackTarget);

      const { broadcast } = await import('../wsServer.js');
      broadcast();

      handleChatAction({
        scope: 'global',
        type: 'chat',
        subtype: 'death',
        message: `${attacker.name} defeated ${attackTarget.name}`,
      });
      break;

    case 'npc': {
      if (attackTarget.experienceValue) {
        attacker.experience += attackTarget.experienceValue;
        levelUpPlayer(attacker);
        await updatePlayer(attacker);
      }

      const droppedItems: DroppedItem[] = [];

      for (const drop of attackTarget.itemsToDrop ?? []) {
        if (randomChance(drop.chance)) {
          const item = getItemById(drop.itemId);
          if (!item) {
            logger.warn('[drop] Item not found', { itemId: drop.itemId });
            continue;
          }

          droppedItems.push({
            itemId: drop.itemId,
            sprite: item.sprite,
            position: {
              x: attackTarget.position.x,
              y: attackTarget.position.y,
            },
          });
        }
      }

      map.droppedItems.push(...droppedItems);
      respawnNpc(attacker.mapId, attackTarget);
      break;
    }
  }
};
