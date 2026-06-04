import {
  RESPAWN_POSITION,
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  DEFAULT_PLAYER_SPEED,
  TILE_SIZE,
  FIRST_GAME_MAP_ID,
  EQUIPMENT_SLOTS,
} from '../../shared/constants.js';
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
import PlayerModel from '../model/Player.js';

import { addPlayer, getPlayer, players, updatePlayer } from '../gameData.js';
import { addPlayerOnMap, removePlayerFromMap } from './mapService.js';
import { getItemById } from './inventoryService.js';
import { broadcast } from '../wsServer.js';
import { handlePlayerUpdate } from './gameService.js';

export async function getPlayerById(id: string): Promise<PlayerRecord | null> {
  return await PlayerModel.findOne({ id }).lean<PlayerRecord>().exec();
}

export async function createOrUpdatePlayer(
  player: PlayerServer,
): Promise<void> {
  await PlayerModel.findOneAndUpdate(
    { id: player.id },
    { $set: player },
    { upsert: false },
  );
}

export async function deletePlayer(id: string): Promise<void> {
  await PlayerModel.deleteOne({ id });
}

export async function listPlayers(): Promise<PlayerServer[]> {
  return await PlayerModel.find().lean<PlayerServer[]>().exec();
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
      !(await PlayerModel.exists({})));

  const newPlayer: PlayerServer = {
    id: Math.random().toString(36).substring(2, 9),
    name: username,
    position: RESPAWN_POSITION,
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    speed: DEFAULT_PLAYER_SPEED,
    kind: 'player',
    attack: 100,
    vitality: 0,
    unspentPoints: 0,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    attackRange: TILE_SIZE,
    mapId: FIRST_GAME_MAP_ID,
    sprite: 0,
    maxHealth: 100,
    health: 100,
    inventory: {
      items: [],
      maxCapacity: 10,
    },
    equipped: {},
    access: isAdmin ? Access.ADMIN : Access.USER,
    direction: Direction.Down,
    action: CharacterAction.Idle,
  };

  await PlayerModel.create({ ...newPlayer, password });
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

export const levelUpPlayer = (player: PlayerServer): void => {
  const POINTS_PER_LEVEL = 5;

  while (player.experience >= player.experienceToNextLevel) {
    player.experience -= player.experienceToNextLevel;
    player.level++;
    player.experienceToNextLevel = Math.floor(
      100 * Math.pow(1.5, player.level - 1),
    );

    player.unspentPoints += POINTS_PER_LEVEL;
  }
};

export const handlePlayerUpdates = (player: PlayerServer): void => {
  const existingPlayer = getPlayer(player.id);
  if (existingPlayer) {
    updatePlayer({ ...existingPlayer, ...player }).catch((e) => {
      console.error('updatePlayer failed:', e);
    });
  }
};

export const respawnPlayer = (player: PlayerServer): void => {
  player.health = player.maxHealth;
  removePlayerFromMap(player.id);
  player.mapId = FIRST_GAME_MAP_ID;
  player.position = RESPAWN_POSITION;
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
  const inventory: InventoryItemDetailed[] = player.inventory.items.map(
    (entry) => {
      const item = getItemById(entry.item);

      if (!item) throw new Error(`Item ${entry.item} not found`);
      return { item, quantity: entry.quantity };
    },
  );

  const equipped: EquippedItemsDetailed = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = player.equipped[slot];
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
  Object.values(players).find((player) => player.name === username);

export async function getPlayerByNameFromDb(
  name: string,
): Promise<PlayerRecord | null> {
  return await PlayerModel.findOne({ name }).lean<PlayerRecord>().exec();
}

export const changeSprite = (spriteId: number, username: string) => {
  const newPlayer: PlayerServer = {
    ...getPlayerByName(username)!,
    sprite: spriteId,
  };
  handlePlayerUpdate(newPlayer);
  broadcast();
};
