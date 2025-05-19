import {
  PlayerServer,
  Character,
  Direction,
  MapStateServer,
  DroppedItem,
} from '../../shared/types';
import { getMap, updatePlayer } from '../gameData';
import { handleChatAction } from './chatService';
import { getItemById } from './inventoryService';
import { isNpc, respawnNpc } from './npcService';
import { isPlayer, respawnPlayer, levelUpPlayer } from './playerService';

const isInAttackRange = (
  attacker: PlayerServer,
  target: Character,
): boolean => {
  const distanceX = Math.abs(attacker.position.x - target.position.x);
  const distanceY = Math.abs(attacker.position.y - target.position.y);

  return distanceX <= attacker.attackRange && distanceY <= attacker.attackRange;
};

const isFacingTarget = (attacker: PlayerServer, target: Character): boolean => {
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
): Character | undefined => {
  if (map.type === 'pvp') {
    const opponentPlayers = Object.values(map.players).filter(
      (player) =>
        player.id !== attacker.id &&
        player.health > 0 &&
        isInAttackRange(attacker, player) &&
        isFacingTarget(attacker, player),
    );

    if (opponentPlayers.length > 0) {
      return opponentPlayers[0];
    }
  }

  const npcTargets = Object.values(map.npcs).filter(
    (npc) =>
      npc.behavior !== 'neutral' &&
      npc.health > 0 &&
      isInAttackRange(attacker, npc) &&
      isFacingTarget(attacker, npc),
  );

  return npcTargets[0];
};

export const handleAttack = async (attacker: PlayerServer): Promise<void> => {
  if (!attacker) return;

  const map = getMap(attacker.mapId);
  if (!map) return;

  const attackTarget = await findAttackTarget(attacker, map);
  if (!attackTarget) return;

  if (isNpc(attackTarget) && attackTarget.behavior === 'neutral') return;

  attackTarget.health -= attacker.attack;

  if (attackTarget.health > 0) return;

  attackTarget.health = 0;

  if (isPlayer(attackTarget)) {
    respawnPlayer(attackTarget);
    await updatePlayer(attackTarget);

    handleChatAction({
      scope: 'global',
      type: 'chat',
      subtype: 'death',
      message: `${attacker.name} defeated ${attackTarget.name}`,
    });
  } else if (isNpc(attackTarget)) {
    if (attackTarget.experienceValue) {
      attacker.experience += attackTarget.experienceValue;
      levelUpPlayer(attacker);
      await updatePlayer(attacker);
    }

    if (attackTarget.itemsToDrop?.length) {
      const droppedItems: DroppedItem[] = [];

      for (const drop of attackTarget.itemsToDrop) {
        const roll = Math.random() * 100;
        if (roll <= drop.chance) {
          const item = await getItemById(drop.itemId);
          if (!item) {
            console.warn(`[drop] Item not found: ${drop.itemId}`);
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
    }

    respawnNpc(attacker.mapId, attackTarget);
  }
};
