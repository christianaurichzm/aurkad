import {
  PlayerServer,
  MapStateServer,
  DroppedItem,
  CombatTarget,
  RuntimeNpc,
  LootEntry,
  LootTable,
  DamageContributor,
  CharacterAction,
} from '../../../shared/types.js';
import { getMap, updatePlayer } from '../world/gameData.js';
import { logger } from '../../logger.js';
import { getTick, msToTicks } from '../../sim/clock.js';
import { cancelScheduled, scheduleAfter } from '../../sim/scheduler.js';
import { queryEntitiesInRadius } from '../../spatial/spatialManager.js';
import { gameConfig } from '../../gameConfig.js';
import { isFacing, mapAllowsPvp } from '../../../shared/utils.js';
import { tryConsumeAttackCooldown } from './attackCooldown.js';
import {
  clampDamage,
  clearDamageContributions,
  damageContributors,
  recordDamageContribution,
} from './damage.js';
import { handleChatAction } from '../comms/chatService.js';
import { getItemById } from '../economy/inventoryService.js';
import { rollLootTable } from '../economy/lootService.js';
import { getLootTable } from '../economy/lootTableService.js';
import { respawnNpc } from '../npc/index.js';
import { markNpcAggro } from '../npc/aiBrain.js';
import { respawnPlayer, awardExperience } from '../player/playerService.js';
import { emit } from '../../engine/hooks.js';
import { dispatchEntityScript } from '../../engine/scripting/entityScripts.js';
import { sendCustomEvent } from '../comms/customEventService.js';
import { useApi } from '../../engine/modules/registry.js';
import { recordHealthChange } from '../../net/snapshot.js';

export type ResolveDamageOptions = {
  attacker?: CombatTarget;
  map?: MapStateServer;
};

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
    if (!isFacing(attacker, target)) continue;

    return target;
  }

  return undefined;
};

/** What a `lootCondition.<name>` predicate is handed to decide with. */
export interface LootConditionContext {
  npc: RuntimeNpc;
  /** Absent when something other than a player finished the npc off. */
  killer?: PlayerServer;
  /** Damage this killer dealt over the fight, not just the killing blow. */
  contribution: number;
  /** Damage every player dealt together, so a share can be worked out. */
  totalDamage: number;
  contributors: DamageContributor[];
}

/**
 * Drops entries whose condition says no, before anything is rolled, so a
 * weighted pool spreads the missing weight over what remains instead of
 * turning it into "nothing dropped". A condition nothing registered removes
 * the entry, and is logged: a script that failed to load gives nobody boss
 * loot rather than everybody.
 */
function applyLootConditions(
  table: LootTable,
  npc: RuntimeNpc,
  killer: PlayerServer | undefined,
  contributors: DamageContributor[],
): LootTable {
  const hasCondition =
    (table.guaranteed ?? []).some((entry) => entry.condition) ||
    (table.entries ?? []).some((entry) => entry.condition);
  if (!hasCondition) return table;

  const totalDamage = contributors.reduce((sum, c) => sum + c.damage, 0);
  const ctx: LootConditionContext = {
    npc,
    ...(killer ? { killer } : {}),
    contribution: killer
      ? (contributors.find((c) => c.playerId === killer.id)?.damage ?? 0)
      : 0,
    totalDamage,
    contributors,
  };

  const allowed = (entry: LootEntry): boolean => {
    if (!entry.condition) return true;
    const predicate = useApi<(context: LootConditionContext) => boolean>(
      `lootCondition.${entry.condition}`,
    );
    if (!predicate) {
      logger.warn('[drop] loot entry names an unregistered condition', {
        npc: npc.id,
        condition: entry.condition,
      });
      return false;
    }
    try {
      return predicate(ctx) === true;
    } catch (err) {
      // Same reasoning as the missing predicate: a throwing condition is a
      // condition that did not say yes.
      logger.error('[drop] loot condition threw', {
        npc: npc.id,
        condition: entry.condition,
        err,
      });
      return false;
    }
  };

  return {
    ...table,
    ...(table.guaranteed
      ? { guaranteed: table.guaranteed.filter(allowed) }
      : {}),
    ...(table.entries ? { entries: table.entries.filter(allowed) } : {}),
  };
}

/** Turns an NPC's death into the items that hit the ground. */
function rollNpcLoot(
  npc: RuntimeNpc,
  killer: PlayerServer | undefined,
  contributors: DamageContributor[],
): DroppedItem[] {
  const table = npc.lootTableId ? getLootTable(npc.lootTableId) : undefined;
  if (npc.lootTableId && !table) {
    logger.warn('[drop] npc references an unknown loot table', {
      npc: npc.id,
      lootTableId: npc.lootTableId,
    });
  }

  const rolled = table
    ? rollLootTable(applyLootConditions(table, npc, killer, contributors))
    : [];

  const dropped: DroppedItem[] = [];
  for (const drop of rolled) {
    const item = getItemById(drop.itemId);
    if (!item) {
      logger.warn('[drop] Item not found', { itemId: drop.itemId });
      continue;
    }
    dropped.push({
      itemId: drop.itemId,
      sprite: item.sprite,
      position: { x: npc.position.x, y: npc.position.y },
      quantity: drop.quantity,
    });
  }
  return dropped;
}

export const resolveDamage = (
  target: CombatTarget,
  amount: number,
  options: ResolveDamageOptions = {},
): number => {
  if (target.health <= 0) return 0;

  const { attacker } = options;
  const map = options.map ?? getMap(target.mapId);
  const damageCtx = { value: resolveBaseDamage(amount, attacker, target) };
  emit('beforeDamage', { attacker, target, damage: damageCtx });

  const damage = clampDamage(damageCtx.value);
  if (damage <= 0) return 0;

  // After the clamp, so the ledger holds what was actually dealt rather than
  // what a beforeDamage handler asked for.
  if (attacker?.kind === 'player') {
    recordDamageContribution(target.id, attacker.id, damage);
  }

  target.health -= damage;
  recordHealthChange(target, -damage);

  const lethal = target.health <= 0;
  emit('afterDamage', { attacker, target, damage, lethal });

  if (target.health > 0) {
    if (target.kind === 'player') {
      updatePlayer(target);
    } else if (attacker?.kind === 'player') {
      // Retaliation. Acquisition by sight cannot see an archer two tiles
      // outside the notice radius, and without this the npc dies wandering.
      markNpcAggro(target, attacker.id);
    }
    return damage;
  }

  target.health = 0;

  switch (target.kind) {
    case 'player': {
      emit('playerDeath', { player: target, killer: attacker });
      clearDamageContributions(target.id);
      respawnPlayer(target);
      updatePlayer(target);

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
      const contributors = damageContributors(target.id);
      if (attacker?.kind === 'player') {
        emit('npcDeath', { npc: target, killer: attacker, contributors });
        dispatchEntityScript(
          target.scriptId,
          'onDeath',
          { npc: target, killer: attacker },
          target.scriptParams,
        );
        if (target.experienceValue) {
          awardExperience(attacker, target.experienceValue, 'kill');
          updatePlayer(attacker);
        }
      }

      if (map) {
        map.droppedItems.push(
          ...rollNpcLoot(
            target,
            attacker?.kind === 'player' ? attacker : undefined,
            contributors,
          ),
        );
      }
      respawnNpc(map?.id ?? target.mapId, target);
      // Cleared last, so the loot roll above still sees the fight. A respawn
      // keeps the id, so the next kill would inherit these contributors, and an
      // npc finished off by something else would hold its ledger forever.
      clearDamageContributions(target.id);
      break;
    }
  }

  return damage;
};

// How long the attack pose shows. It ends on its own, held key or not: a
// sprite has one attack frame, and held it reads as a frozen blow. Ending it
// also means the next swing is an edge into Attack again, which is what a
// viewer's client plays the swing sound on.
const SWING_MS = 250;
const swingEnds = new WeakMap<{ action: CharacterAction }, number>();

export const swing = (entity: { action: CharacterAction }): void => {
  const pending = swingEnds.get(entity);
  if (pending !== undefined) cancelScheduled(pending);
  entity.action = CharacterAction.Attack;
  swingEnds.set(
    entity,
    scheduleAfter(msToTicks(SWING_MS), () => {
      swingEnds.delete(entity);
      if (entity.action === CharacterAction.Attack) {
        entity.action = CharacterAction.Idle;
      }
    }),
  );
};

export const handleAttack = (attacker: PlayerServer): void => {
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

  sendCustomEvent(attacker, 'attack:hit', {
    x: attacker.position.x,
    y: attacker.position.y,
    dir: attacker.direction,
  });

  resolveDamage(attackTarget, attacker.attack, { attacker, map });
};
