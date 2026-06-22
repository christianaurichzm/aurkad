import {
  PlayerServer,
  Direction,
  MapStateServer,
  DroppedItem,
  CombatTarget,
  PvpMorale,
} from '../../../shared/types.js';
import { getMap, updatePlayer } from '../../gameData.js';
import { logger } from '../../logger.js';
import { getTick } from '../../sim/clock.js';
import { randomChance } from '../../sim/rng.js';
import { queryEntitiesInRadius } from '../../spatial/spatialManager.js';
import { gameConfig } from '../../gameConfig.js';
import { tryConsumeAttackCooldown } from './attackCooldown.js';
import { clampDamage } from './damage.js';
import { handleChatAction } from '../chatService.js';
import { getItemById } from '../inventoryService.js';
import { respawnNpc } from '../npc/index.js';
import { respawnPlayer, awardExperience } from '../playerService.js';
import { emit } from '../../engine/hooks.js';

export type ResolveDamageOptions = {
  attacker?: CombatTarget;
  map?: MapStateServer;
};

// A map's PvP morale, deriving from `type` when unset (back-compat).
export const mapPvpMorale = (map: {
  type: MapStateServer['type'];
  pvp?: PvpMorale;
}): PvpMorale => map.pvp ?? (map.type === 'pvp' ? 'no-penalty' : 'safe');

export const mapAllowsPvp = (map: {
  type: MapStateServer['type'];
  pvp?: PvpMorale;
}): boolean => mapPvpMorale(map) !== 'safe';

const playerStat = (
  entity: CombatTarget | undefined,
  stat: 'strength' | 'defense' | 'agility',
): number => (entity?.kind === 'player' ? entity[stat] : 0);

const resolveBaseDamage = (
  amount: number,
  attacker: CombatTarget | undefined,
  target: CombatTarget,
): number => {
  if (!Number.isFinite(amount) || amount <= 0) return amount;

  const {
    baseDamageMultiplier,
    strengthDamageMultiplier,
    defenseDamageReduction,
    minimumDamage,
  } = gameConfig.combat;

  const value =
    amount * baseDamageMultiplier +
    playerStat(attacker, 'strength') * strengthDamageMultiplier -
    playerStat(target, 'defense') * defenseDamageReduction;

  return Math.max(minimumDamage, value);
};

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
      (mapAllowsPvp(map) ? map.players[entity.id] : undefined) ??
      map.npcs[entity.id];

    if (!target || target.health <= 0) continue;
    if (
      target.kind === 'npc' &&
      target.behavior !== 'aggressive' &&
      target.behavior !== 'hostile'
    )
      continue;
    if (!isInAttackRange(attacker, target)) continue;
    if (!isFacingTarget(attacker, target)) continue;

    return target;
  }

  return undefined;
};

export const resolveDamage = async (
  target: CombatTarget,
  amount: number,
  options: ResolveDamageOptions = {},
): Promise<number> => {
  if (target.health <= 0) return 0;

  const { attacker } = options;
  const map = options.map ?? getMap(target.mapId);
  const damageCtx = { value: resolveBaseDamage(amount, attacker, target) };
  emit('beforeDamage', { attacker, target, damage: damageCtx });

  const damage = clampDamage(damageCtx.value);
  if (damage <= 0) return 0;

  target.health -= damage;

  if (target.health > 0) {
    if (target.kind === 'player') {
      await updatePlayer(target);
    }
    return damage;
  }

  target.health = 0;

  switch (target.kind) {
    case 'player': {
      emit('playerDeath', { player: target, killer: attacker });
      respawnPlayer(target);
      await updatePlayer(target);

      const { broadcast } = await import('../../net/index.js');
      broadcast();

      if (attacker?.kind === 'player') {
        handleChatAction({
          scope: 'global',
          type: 'chat',
          subtype: 'death',
          message: `${attacker.name} defeated ${target.name}`,
        });
      }
      break;
    }

    case 'npc': {
      if (attacker?.kind === 'player') {
        emit('npcDeath', { npc: target, killer: attacker });
        if (target.experienceValue) {
          awardExperience(attacker, target.experienceValue, 'kill');
          await updatePlayer(attacker);
        }
      }

      const droppedItems: DroppedItem[] = [];

      for (const drop of target.itemsToDrop ?? []) {
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
              x: target.position.x,
              y: target.position.y,
            },
            quantity: Math.max(1, Math.floor(drop.quantity ?? 1)),
          });
        }
      }

      if (map) {
        map.droppedItems.push(...droppedItems);
      }
      respawnNpc(map?.id ?? target.mapId, target);
      break;
    }
  }

  return damage;
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

  if (
    attackTarget.kind === 'npc' &&
    attackTarget.behavior !== 'aggressive' &&
    attackTarget.behavior !== 'hostile'
  )
    return;

  await resolveDamage(attackTarget, attacker.attack, { attacker, map });
};
