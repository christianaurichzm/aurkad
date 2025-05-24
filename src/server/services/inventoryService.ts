import {
  MapStateServer,
  PlayerServer,
  ClientItemAction,
  Item,
  ModifiablePlayerAttribute,
} from '../../shared/types';
import { updatePlayer, updateMap, items } from '../gameData';
import ItemModel from '../model/Item';
import { getNextItemId } from './dbService';
import { EQUIPMENT_SLOTS } from '../../shared/constants';
import { getPlayerByName } from './playerService';

export function getItemById(id: number): Item | null {
  return items.get(id) ?? null;
}

export async function createOrUpdateItem(item: any): Promise<void> {
  if (!item.id) {
    item.id = await getNextItemId();
  }

  await ItemModel.findOneAndUpdate({ id: item.id }, item, {
    upsert: true,
  });

  items.set(item.id, { ...item, id: item.id });
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

  const drop = map.droppedItems[dropIndex];

  const existing = player.inventory.items.find((i) => i.item === drop.itemId);

  if (existing) {
    existing.quantity += 1;
  } else if (player.inventory.items.length < player.inventory.maxCapacity) {
    player.inventory.items.push({ item: drop.itemId, quantity: 1 });
  }

  map.droppedItems.splice(dropIndex, 1);
  await updatePlayer(player);
  updateMap(map);
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
      console.log('[useItem] item is equipped, proceeding to unequip');
      await unequipItem(player, slot);
    } else if (invItem) {
      console.log('[useItem] equipping item from inventory');
      await equipItem(player, itemId);
    } else {
      console.warn('[useItem] item not in inventory nor equipped');
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
    console.warn(`Invalid equip slot: ${slot}`);
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
  player: Pick<PlayerServer, ModifiablePlayerAttribute>,
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
      player[attribute] *= reverse ? 1 / value : value;
    }
  }
}
