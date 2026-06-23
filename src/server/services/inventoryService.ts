import { MapStateServer, PlayerServer, Item } from '../../shared/types.js';
import type { ClientItemAction } from '../engine/actions.js';
import { getMap, updatePlayer, updateMap, items } from '../gameData.js';
import { logger } from '../logger.js';
import ItemModel from '../model/Item.js';
import { getNextItemId } from './dbService.js';
import { EQUIPMENT_SLOTS } from '../../shared/constants.js';
import { getPlayerByName, levelUpPlayer } from './playerService.js';
import { emit } from '../engine/hooks.js';

export function getItemById(id: number): Item | null {
  return items.get(id) ?? null;
}

export async function createOrUpdateItem(
  item: Omit<Item, 'id'> & { id?: number },
): Promise<void> {
  if (!item.id) {
    item.id = await getNextItemId();
  }

  const id = item.id;
  await ItemModel.findOneAndUpdate({ id }, item, { upsert: true });
  items.set(id, { ...item, id } as Item);
}

export async function deleteItem(id: number): Promise<void> {
  await ItemModel.deleteOne({ id });
  items.delete(id);
}

export async function listItems(): Promise<Item[]> {
  return await ItemModel.find().lean<Item[]>().exec();
}

export const pickUpItem = async (map: MapStateServer, player: PlayerServer) => {
  const dropIndex = map.droppedItems.findIndex(
    (drop) =>
      drop.position.x === player.position.x &&
      drop.position.y === player.position.y,
  );

  if (dropIndex === -1) return;

  const drop = map.droppedItems[dropIndex]!;

  const existing = player.inventory.items.find((i) => i.item === drop.itemId);

  if (existing) {
    existing.quantity += drop.quantity;
  } else if (player.inventory.items.length < player.inventory.maxCapacity) {
    player.inventory.items.push({ item: drop.itemId, quantity: drop.quantity });
  } else {
    // Leave it on the ground rather than deleting it when there is no room.
    return;
  }

  map.droppedItems.splice(dropIndex, 1);
  emit('itemPickup', { player, itemId: drop.itemId, quantity: drop.quantity });
  await updatePlayer(player);
  updateMap(map);
};

export const handleItemAction = (action: ClientItemAction) => {
  const { username, item, action: itemAction, quantity } = action;

  switch (itemAction) {
    case 'use':
      useItem(username, item).catch((e) => {
        logger.error('useItem failed', { err: e });
      });
      break;
    case 'drop':
      dropItemFromInventory(username, item, quantity).catch((e) => {
        logger.error('dropItemFromInventory failed', { err: e });
      });
      break;
    default:
      logger.warn('Unknown item action', { itemAction });
      break;
  }
};

export async function removeItemFromInventory(
  username: string,
  itemId: number,
): Promise<boolean> {
  const player = getPlayerByName(username);
  if (!player) return false;

  player.inventory.items = player.inventory.items.filter(
    (i) => i.item !== itemId,
  );

  await updatePlayer(player);
  return true;
}

export async function dropItemFromInventory(
  username: string,
  itemId: number,
  requestedQuantity = 1,
): Promise<boolean> {
  const player = getPlayerByName(username);
  if (!player) return false;

  const invItem = player.inventory.items.find((i) => i.item === itemId);
  if (!invItem || invItem.quantity <= 0) return false;

  const item = getItemById(itemId);
  if (!item) return false;

  const map = getMap(player.mapId);
  if (!map) return false;

  const quantity = Math.max(
    1,
    Math.min(Math.floor(requestedQuantity), invItem.quantity),
  );

  invItem.quantity -= quantity;
  if (invItem.quantity <= 0) {
    player.inventory.items = player.inventory.items.filter(
      (i) => i.item !== itemId,
    );
  }

  map.droppedItems.push({
    itemId,
    sprite: item.sprite,
    position: { ...player.position },
    quantity,
  });
  updateMap(map);

  await updatePlayer(player);
  return true;
}

export async function useItem(
  username: string,
  itemId: number,
): Promise<boolean> {
  const player = getPlayerByName(username);
  if (!player) return false;

  const item = await getItemById(itemId);
  if (!item) return false;

  const invItem = player.inventory.items.find((i) => i.item === itemId);

  if (item.type === 'consumable') {
    if (!invItem || invItem.quantity <= 0) return false;

    emit('itemUse', { player, itemId });
    await applyItemEffects(player, itemId);
    invItem.quantity--;
    if (invItem.quantity <= 0) {
      player.inventory.items = player.inventory.items.filter(
        (i) => i.item !== itemId,
      );
    }
  } else {
    const slot = item.type as keyof PlayerServer['equipped'];
    const equippedItem = player.equipped[slot];

    if (!invItem && equippedItem === itemId) {
      await unequipItem(player, slot);
    } else if (invItem) {
      await equipItem(player, itemId);
    } else {
      logger.warn('[useItem] item not in inventory nor equipped');
      return false;
    }
  }

  await updatePlayer(player);
  return true;
}

export async function equipItem(
  player: PlayerServer,
  itemId: number,
): Promise<void> {
  const item = await getItemById(itemId);
  if (!item) return;

  const slot = item.type as keyof PlayerServer['equipped'];

  if (!EQUIPMENT_SLOTS.includes(slot)) {
    logger.warn('Invalid equip slot', { slot });
    return;
  }

  if (Number(player.equipped[slot]) === Number(itemId)) {
    await unequipItem(player, slot);
    return;
  }

  if (player.equipped[slot]) {
    await unequipItem(player, slot);
  }

  player.equipped[slot] = itemId;

  const existing = player.inventory.items.find((i) => i.item === itemId);
  if (existing) {
    existing.quantity--;
    if (existing.quantity <= 0) {
      player.inventory.items = player.inventory.items.filter(
        (i) => i.item !== itemId,
      );
    }
  }

  await applyItemEffects(player, itemId);
}

export async function unequipItem(
  player: PlayerServer,
  slot: keyof PlayerServer['equipped'],
): Promise<void> {
  const itemId = player.equipped[slot];
  if (!itemId) return;

  await applyItemEffects(player, itemId, true);

  const existing = player.inventory.items.find((i) => i.item === itemId);
  if (existing) {
    existing.quantity++;
  } else {
    player.inventory.items.push({ item: itemId, quantity: 1 });
  }

  player.equipped[slot] = undefined;
}

export async function applyItemEffects(
  player: PlayerServer,
  itemId: number,
  reverse = false,
): Promise<void> {
  const item = await getItemById(itemId);
  if (!item?.effects) return;

  for (const effect of item.effects) {
    const { attribute, type, value } = effect;

    if (type === 'add') {
      player[attribute] += reverse ? -value : value;
    } else if (type === 'multiply') {
      if (reverse) {
        player[attribute] /= value;
      } else {
        player[attribute] *= value;
      }
    }
  }

  player.health = Math.max(0, Math.min(player.health, player.maxHealth));
  if (!reverse) levelUpPlayer(player);
}
