import {
  MapState,
  Player,
  ClientItemAction,
  Item,
  Character,
  Effect,
} from '../../shared/types';
import { getItems, updatePlayer, updateMap } from '../database';
import { getPlayerByName } from './gameService';

export const pickUpItem = (map: MapState, player: Player) => {
  map.droppedItems.forEach((item, index) => {
    if (
      item.position.x === player.position.x &&
      item.position.y === player.position.y
    ) {
      const itemData = getItems()[item.itemId];

      const existing = player.inventory.items.find((i) => i.id === itemData.id);

      if (existing) {
        existing.quantity += 1;
      } else if (player.inventory.items.length < player.inventory.maxCapacity) {
        player.inventory.items.push({
          ...itemData,
          quantity: 1,
        });
      }

      map.droppedItems.splice(index, 1);
      updatePlayer(player);
      updateMap(map);
    }
  });
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
