import {
  RESPAWN_POSITION,
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  DEFAULT_PLAYER_SPEED,
  TILE_SIZE,
  FIRST_GAME_MAP_ID,
  EQUIPMENT_SLOTS,
} from '../../shared/constants';
import {
  PlayerServer,
  Access,
  Direction,
  CharacterAction,
  EquippedItemsDetailed,
  InventoryItemDetailed,
  Player,
} from '../../shared/types';
import PlayerModel from '../model/Player';

import { addPlayer, getPlayer, players, updatePlayer } from '../gameData';
import { addPlayerOnMap, removePlayerFromMap } from './mapService';
import { getItemById } from './inventoryService';
import { handlePlayerUpdate } from './gameService';
import { broadcast } from '../wsServer';

export async function getPlayerById(id: string): Promise<PlayerServer | null> {
  return await PlayerModel.findOne({ id }).lean<PlayerServer>().exec();
}

export async function createOrUpdatePlayer(
  player: PlayerServer,
): Promise<void> {
  await PlayerModel.findOneAndUpdate({ id: player.id }, player, {
    upsert: true,
  });
}

export async function deletePlayer(id: string): Promise<void> {
  await PlayerModel.deleteOne({ id });
}

export async function listPlayers(): Promise<PlayerServer[]> {
  return await PlayerModel.find().lean<PlayerServer[]>().exec();
}

export const createPlayer = async (username: string): Promise<PlayerServer> => {
  const newPlayer: PlayerServer = {
    id: Math.random().toString(36).substring(2, 9),
    name: username,
    position: RESPAWN_POSITION,
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    speed: DEFAULT_PLAYER_SPEED,
    kind: 'player',
    attack: 100,
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
    access: Access.ADMIN,
    direction: Direction.Down,
    action: CharacterAction.Idle,
  };

  await addPlayer(newPlayer);
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
  while (player.experience >= player.experienceToNextLevel) {
    player.experience -= player.experienceToNextLevel;
    player.level++;
    player.experienceToNextLevel = Math.floor(
      100 * Math.pow(1.5, player.level - 1),
    );
  }
};

export const handlePlayerUpdates = (player: PlayerServer): void => {
  const existingPlayer = getPlayer(player.id);
  if (existingPlayer) {
    updatePlayer({ ...existingPlayer, ...player });
  }
};

export const respawnPlayer = (player: PlayerServer): void => {
  player.health = player.maxHealth;
  removePlayerFromMap(player.id);
  player.mapId = FIRST_GAME_MAP_ID;
  player.position = RESPAWN_POSITION;
  addPlayerOnMap(player.id);
};

export async function enrichPlayer(player: PlayerServer): Promise<Player> {
  const detailedInventory: InventoryItemDetailed[] = await Promise.all(
    player.inventory.items.map(async (entry) => {
      const item = await getItemById(entry.item);

      if (!item) throw new Error(`Item ${entry.item} not found`);
      return { item, quantity: entry.quantity };
    }),
  );

  const equipped: EquippedItemsDetailed = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = player.equipped[slot];
    if (itemId) {
      const item = await getItemById(itemId);
      if (item) equipped[slot] = item;
    }
  }

  const { inventory, equipped: _, ...rest } = player;

  return {
    ...rest,
    inventory: detailedInventory,
    equipped,
  };
}

export const getPlayerByName = (username: string): PlayerServer | undefined =>
  Object.values(players).find((player) => player.name === username);

export async function getPlayerByNameFromDb(
  name: string,
): Promise<PlayerServer | null> {
  const result = await PlayerModel.findOne({ name })
    .lean<PlayerServer>()
    .exec();
  return result;
}

export const changeSprite = (spriteId: number, username: string) => {
  const newPlayer: PlayerServer = {
    ...getPlayerByName(username)!,
    sprite: spriteId,
  };
  handlePlayerUpdate(newPlayer);
  broadcast();
};
