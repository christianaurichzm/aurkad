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
  Inventory,
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
    attack: 80,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    attackRange: TILE_SIZE,
    mapId: FIRST_GAME_MAP_ID,
    sprite: 0,
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
  player.health = 100;
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
  console.log(itemId);
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
  if (item.type === 'weapon' || item.type === 'armor') {
    equipItem(player, item);
  } else {
    if (item.effects) {
      applyItemEffects(player, item.effects);
      removeItemFromInventory(player.id, item.id);
    }
  }
  updatePlayer(player);
  return true;
}

function equipItem(player: Player, item: Item): void {
  if (item.type === 'weapon') {
    if (player.equipped.weapon) {
      unequipItem(player, player.equipped.weapon);
    }
    player.equipped.weapon = item;
    applyItemEffects(player, item.effects ?? []);
  } else if (item.type === 'armor') {
    if (player.equipped.armor) {
      unequipItem(player, player.equipped.armor);
    }
    player.equipped.armor = item;
    applyItemEffects(player, item.effects ?? []);
  }
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
