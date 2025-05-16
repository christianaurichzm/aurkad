import { renderEquipment } from '../client/graphics/inventory';
import {
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  DEFAULT_PLAYER_SPEED,
  FIRST_GAME_MAP_ID,
  RESPAWN_POSITION,
  TILE_SIZE,
} from '../shared/constants';
import {
  PlayerAction,
  Direction,
  Player,
  Access,
  Item,
  Effect,
  Character,
  ClientKeyboardAction,
  ClientItemAction,
} from '../shared/types';
import { addPlayer, getItems, getPlayer, updatePlayer } from './database';
import {
  addPlayerOnMap,
  getPlayerByName,
  handleKeyPress,
  handleKeyRelease,
  removePlayerFromMap,
} from './gameService';

export const createPlayer = (username: string): Player => {
  const newPlayer: Player = {
    id: Math.random().toString(36).substring(2, 9),
    name: username,
    position: RESPAWN_POSITION,
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    speed: DEFAULT_PLAYER_SPEED,
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
    access: Access.USER,
    direction: Direction.Down,
    action: PlayerAction.Idle,
  };

  addPlayer(newPlayer);
  return newPlayer;
};

export const isPlayer = (char: Character): char is Player => {
  return (char as Player).inventory !== undefined;
};

export const levelUpPlayer = (player: Player): void => {
  while (player.experience >= player.experienceToNextLevel) {
    player.experience -= player.experienceToNextLevel;
    player.level++;
    player.experienceToNextLevel = Math.floor(
      100 * Math.pow(1.5, player.level - 1),
    );
  }
};

export const handlePlayerUpdates = (player: Player): void => {
  const existingPlayer = getPlayer(player.id);
  if (existingPlayer) {
    updatePlayer({ ...existingPlayer, ...player });
  }
};

export const respawnPlayer = (player: Player): void => {
  player.health = player.maxHealth;
  removePlayerFromMap(player.id);
  player.mapId = FIRST_GAME_MAP_ID;
  player.position = RESPAWN_POSITION;
  addPlayerOnMap(player.id);
};

export const handleKeyAction = (action: ClientKeyboardAction) => {
  const { username, keyboardAction } = action;
  switch (keyboardAction.type) {
    case 'press':
      handleKeyPress(username, keyboardAction.key);
      break;
    case 'release':
      handleKeyRelease(username, keyboardAction.key);
      break;
    default:
      console.warn(`Unknown item action: ${keyboardAction.key}`);
      break;
  }
};

export const handleItemAction = (action: ClientItemAction) => {
  const { username, item, action: itemAction } = action;

  switch (itemAction) {
    case 'use':
      useItem(username, item);
      break;
    case 'drop':
      removeItemFromInventory(username, item);
      break;
    default:
      console.warn(`Unknown item action: ${itemAction}`);
      break;
  }
};

export function removeItemFromInventory(
  username: string,
  itemId: number,
): boolean {
  const player = getPlayerByName(username);
  if (!player) return false;
  const itemIndex = player.inventory.items.findIndex(
    (item) => item.id === itemId,
  );
  if (itemIndex === -1) {
    console.log('Item not found!');
    return false;
  }
  player.inventory.items.splice(itemIndex, 1);
  return true;
}

export function useItem(username: string, itemId: number): boolean {
  const player = getPlayerByName(username);
  if (!player) return false;
  const item = Object.values(getItems()).find(
    (invItem) => invItem.id === itemId,
  );
  if (!item) {
    console.log('Item not found!');
    return false;
  }
  const itemIndex = player.inventory.items.findIndex(
    (invItem) => invItem.id === item.id,
  );
  if (itemIndex === -1) {
    console.log('Item not found!');
    return false;
  }
  if (item.type === 'consumable') {
    if (item.effects) {
      applyItemEffects(player, item.effects);
      removeItemFromInventory(player.id, item.id);
    }
  } else {
    equipItem(player, item);
  }
  updatePlayer(player);
  return true;
}

function equipItem(player: Player, item: Item): void {
  switch (item.type) {
    case 'weapon':
      if (player.equipped.weapon) {
        unequipItem(player, player.equipped.weapon);
      }
      player.equipped.weapon = item;
      break;
    case 'helmet':
      if (player.equipped.helmet) {
        unequipItem(player, player.equipped.helmet);
      }
      player.equipped.helmet = item;
      break;
    case 'chestplate':
      if (player.equipped.chestplate) {
        unequipItem(player, player.equipped.chestplate);
      }
      player.equipped.chestplate = item;
      break;
    case 'gloves':
      if (player.equipped.gloves) {
        unequipItem(player, player.equipped.gloves);
      }
      player.equipped.gloves = item;
      break;
    case 'boots':
      if (player.equipped.boots) {
        unequipItem(player, player.equipped.boots);
      }
      player.equipped.boots = item;
      break;
  }
  applyItemEffects(player, item.effects ?? []);
}

function unequipItem(player: Player, item: Item): void {
  if (item.effects) {
    applyItemEffects(player, item.effects, true);
  }
}

function applyItemEffects(
  player: Character,
  effects: Effect[],
  reverse = false,
): void {
  effects.forEach((effect) => {
    const attribute = effect.attribute;
    if (typeof player[attribute] === 'number') {
      switch (effect.type) {
        case 'add':
          player[attribute] += reverse ? -effect.value : effect.value;
          break;
        case 'multiply':
          player[attribute] *= reverse ? 1 / effect.value : effect.value;
          break;
      }
    }
  });
}
