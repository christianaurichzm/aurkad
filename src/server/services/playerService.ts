import {
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  TILE_SIZE,
  EQUIPMENT_SLOTS,
} from '../../shared/constants.js';
import { gameConfig, respawnPosition } from '../gameConfig.js';
import {
  PlayerServer,
  PlayerRecord,
  Access,
  Direction,
  CharacterAction,
  EquippedItemsDetailed,
  InventoryItemDetailed,
  Player,
  PlayerCold,
  PlayerHot,
} from '../../shared/types.js';
import { playerRepository } from '../persistence/playerRepository.js';

import { getPlayer, updatePlayer } from '../gameData.js';
import { getPlayerByName as lookupPlayerByName } from '../sim/world.js';
import { emit } from '../engine/hooks.js';
import { addPlayerOnMap, removePlayerFromMap } from './mapService.js';
import { getItemById } from './inventoryService.js';
import { broadcast } from '../net/index.js';
import { handlePlayerUpdate } from './gameService.js';
import { logger } from '../logger.js';

export async function getPlayerById(id: string): Promise<PlayerRecord | null> {
  return playerRepository.findById(id);
}

export async function createOrUpdatePlayer(
  player: PlayerServer,
): Promise<void> {
  await playerRepository.save(player);
}

export async function deletePlayer(id: string): Promise<void> {
  await playerRepository.deleteById(id);
}

export async function listPlayers(): Promise<PlayerRecord[]> {
  return playerRepository.list();
}

export const createPlayer = async (
  username: string,
  password: string,
): Promise<PlayerServer> => {
  const bootstrapAdminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const isAdmin =
    bootstrapAdminUsername === username ||
    (!bootstrapAdminUsername &&
      process.env.NODE_ENV !== 'production' &&
      !(await playerRepository.anyExists()));

  const { startingAttack, startingMaxHealth, startingSpeed, startingInventoryCapacity } =
    gameConfig.player;
  const { baseXp } = gameConfig.leveling;

  const newPlayer: PlayerServer = {
    id: Math.random().toString(36).substring(2, 9),
    name: username,
    position: respawnPosition,
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    speed: startingSpeed,
    kind: 'player',
    attack: startingAttack,
    vitality: 0,
    unspentPoints: 0,
    level: 1,
    experience: 0,
    experienceToNextLevel: baseXp,
    attackRange: TILE_SIZE,
    mapId: gameConfig.world.startMapId,
    sprite: 0,
    maxHealth: startingMaxHealth,
    health: startingMaxHealth,
    inventory: {
      items: [],
      maxCapacity: startingInventoryCapacity,
    },
    equipped: {},
    access: isAdmin ? Access.ADMIN : Access.USER,
    direction: Direction.Down,
    action: CharacterAction.Idle,
    data: {},
  };

  await playerRepository.insert({ ...newPlayer, password });
  return newPlayer;
};

export const persistPlayerSessionState = async (player: PlayerServer) => {
  await createOrUpdatePlayer({
    ...player,
    position: player.position,
    direction: player.direction,
    action: player.action,
    mapId: player.mapId,
    health: player.health,
  });
};

// Single funnel for all experience gain. Emits a mutable beforeXpGain hook
// (scripts scale it, as in VIP 2x or a weekend bonus), then applies it and
// processes level-ups. Clamps to a finite amount >= 0.
export const awardExperience = (
  player: PlayerServer,
  amount: number,
  source = 'script',
): number => {
  const ctx = { player, amount, source };
  emit('beforeXpGain', ctx);
  const gained = Number.isFinite(ctx.amount) && ctx.amount > 0 ? Math.floor(ctx.amount) : 0;
  if (gained <= 0) return 0;
  player.experience += gained;
  levelUpPlayer(player);
  return gained;
};

export const levelUpPlayer = (player: PlayerServer): void => {
  const { baseXp, xpGrowthRate, pointsPerLevel } = gameConfig.leveling;

  while (player.experience >= player.experienceToNextLevel) {
    player.experience -= player.experienceToNextLevel;
    player.level++;
    player.experienceToNextLevel = Math.floor(
      baseXp * Math.pow(xpGrowthRate, player.level - 1),
    );
    player.unspentPoints += pointsPerLevel;
    emit('playerLevelUp', { player, level: player.level });
  }
};

export const handlePlayerUpdates = (player: PlayerServer): void => {
  const existingPlayer = getPlayer(player.id);
  if (existingPlayer) {
    updatePlayer({ ...existingPlayer, ...player }).catch((e) => {
      logger.error('updatePlayer failed', { err: e });
    });
  }
};

export const respawnPlayer = (player: PlayerServer): void => {
  player.health = player.maxHealth;
  removePlayerFromMap(player.id);
  player.mapId = gameConfig.world.startMapId;
  player.position = respawnPosition;
  addPlayerOnMap(player.id);
};

export function toPlayerHot(player: PlayerServer): PlayerHot {
  return {
    id: player.id,
    position: player.position,
    targetPosition: player.targetPosition,
    moving: player.moving,
    moveTick: player.moveTick,
    moveDurationTicks: player.moveDurationTicks,
    direction: player.direction,
    action: player.action,
    health: player.health,
    lastProcessedSeq: player.lastProcessedSeq,
  };
}

export function toPlayerCold(player: PlayerServer): PlayerCold {
  const inventory: InventoryItemDetailed[] = (
    player.inventory?.items ?? []
  ).map((entry) => {
    const item = getItemById(entry.item);

    if (!item) throw new Error(`Item ${entry.item} not found`);
    return { item, quantity: entry.quantity };
  });

  const equippedSource = player.equipped ?? {};
  const equipped: EquippedItemsDetailed = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = equippedSource[slot];
    if (itemId) {
      const item = getItemById(itemId);
      if (item) equipped[slot] = item;
    }
  }

  return {
    id: player.id,
    name: player.name,
    sprite: player.sprite,
    width: player.width,
    height: player.height,
    maxHealth: player.maxHealth,
    attack: player.attack,
    attackRange: player.attackRange,
    level: player.level,
    experience: player.experience,
    experienceToNextLevel: player.experienceToNextLevel,
    inventory,
    equipped,
    access: player.access,
    vitality: player.vitality,
    unspentPoints: player.unspentPoints,
    speed: player.speed,
    mapId: player.mapId,
    nameColor: player.nameColor,
    kind: 'player',
  };
}

export function playerColdSignature(player: PlayerServer): string {
  return JSON.stringify([
    player.name,
    player.sprite,
    player.width,
    player.height,
    player.maxHealth,
    player.attack,
    player.attackRange,
    player.level,
    player.experience,
    player.experienceToNextLevel,
    player.access,
    player.vitality,
    player.unspentPoints,
    player.speed,
    player.mapId,
    player.nameColor,
    player.inventory,
    player.equipped,
  ]);
}

export function enrichPlayer(player: PlayerServer): Player {
  return {
    ...toPlayerCold(player),
    ...toPlayerHot(player),
  };
}

export const getPlayerByName = (username: string): PlayerServer | undefined =>
  lookupPlayerByName(username);

export async function getPlayerByNameFromDb(
  name: string,
): Promise<PlayerRecord | null> {
  return playerRepository.findByName(name);
}

export const changeSprite = (spriteId: number, username: string) => {
  const newPlayer: PlayerServer = {
    ...getPlayerByName(username)!,
    sprite: spriteId,
  };
  handlePlayerUpdate(newPlayer);
  broadcast();
};
