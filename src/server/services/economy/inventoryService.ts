import {
  MapStateServer,
  PlayerServer,
  Item,
  EquipmentSlot,
  Effect,
} from '../../../shared/types.js';
import type { ClientItemAction } from '../../engine/actions.js';
import { getMap, updatePlayer, updateMap, items } from '../world/gameData.js';
import { logger } from '../../logger.js';
import ItemModel from '../../model/Item.js';
import { getNextItemId } from '../dbService.js';
import { EQUIPMENT_SLOTS } from '../../../shared/constants.js';
import { getPlayerByName, levelUpPlayer } from '../player/playerService.js';
import { emit } from '../../engine/hooks.js';
import { dispatchEntityScript } from '../../engine/scripting/entityScripts.js';
import { addItem, canFit, removeItem } from './economyService.js';
import { sweepUnclaimableDeliveries } from './deliveryService.js';
import { forgetSentItem, recordHealthChange } from '../../net/snapshot.js';

export function getItemById(id: number): Item | null {
  return items.get(id) ?? null;
}

/**
 * Optional fields a caller can clear by leaving them out.
 *
 * Every caller passes a complete item (editor form, content import), which is
 * why the cache line below replaces the entry wholesale. The database write has
 * to agree: a plain `findOneAndUpdate` only writes the keys present, so
 * clearing one in the editor would work until the next restart brought it back.
 */
const CLEARABLE_ITEM_FIELDS = ['scriptId', 'scriptParams', 'arrowId'] as const;

export async function createOrUpdateItem(
  item: Omit<Item, 'id'> & { id?: number },
): Promise<void> {
  if (!item.id) {
    item.id = await getNextItemId();
  }

  const id = item.id;
  const unset: Record<string, ''> = {};
  for (const field of CLEARABLE_ITEM_FIELDS) {
    if (item[field] === undefined) unset[field] = '';
  }

  await ItemModel.findOneAndUpdate(
    { id },
    {
      $set: item,
      ...(Object.keys(unset).length > 0 && { $unset: unset }),
    },
    { upsert: true },
  );
  items.set(id, { ...item, id });
  forgetSentItem(id);
}

export async function deleteItem(id: number): Promise<void> {
  await ItemModel.deleteOne({ id });
  items.delete(id);
  forgetSentItem(id);
  // Anything queued for delivery of this item just became unclaimable, and the
  // recipient cannot get rid of it either. Here rather than in the route: this
  // is the funnel every deletion crosses.
  await sweepUnclaimableDeliveries();
}

export async function listItems(): Promise<Item[]> {
  return await ItemModel.find().lean<Item[]>().exec();
}

export const pickUpItem = (map: MapStateServer, player: PlayerServer) => {
  // The client draws a tile's drops in order, so the last one is the one the
  // player sees on top of the pile.
  const dropIndex = map.droppedItems.findLastIndex(
    (drop) =>
      drop.position.x === player.position.x &&
      drop.position.y === player.position.y,
  );

  if (dropIndex === -1) return;

  const drop = map.droppedItems[dropIndex]!;

  // Leave it on the ground rather than deleting it when there is no room.
  if (!addItem(player.inventory, drop.itemId, drop.quantity).ok) return;

  map.droppedItems.splice(dropIndex, 1);
  emit('itemPickup', { player, itemId: drop.itemId, quantity: drop.quantity });
  updatePlayer(player);
  updateMap(map);
};

export const handleItemAction = (action: ClientItemAction) => {
  const { username, item, action: itemAction, quantity } = action;

  switch (itemAction) {
    case 'use':
      useItem(username, item);
      break;
    case 'drop':
      dropItemFromInventory(username, item, quantity);
      break;
    default:
      logger.warn('Unknown item action', { itemAction });
      break;
  }
};

export function dropItemFromInventory(
  username: string,
  itemId: number,
  requestedQuantity = 1,
): boolean {
  const player = getPlayerByName(username);
  if (!player) return false;

  const invItem = player.inventory.items.find((i) => i.item === itemId);
  if (!invItem || invItem.quantity <= 0) return false;

  const item = getItemById(itemId);
  if (!item || item.bound) return false;

  const map = getMap(player.mapId);
  if (!map) return false;

  const quantity = Math.max(
    1,
    Math.min(Math.floor(requestedQuantity), invItem.quantity),
  );

  if (!removeItem(player.inventory, itemId, quantity).ok) return false;

  map.droppedItems.push({
    itemId,
    sprite: item.sprite,
    position: { ...player.position },
    quantity,
  });
  updateMap(map);

  updatePlayer(player);
  return true;
}

export function useItem(username: string, itemId: number): boolean {
  const player = getPlayerByName(username);
  if (!player) return false;

  const item = getItemById(itemId);
  if (!item) return false;

  const invItem = player.inventory.items.find((i) => i.item === itemId);

  if (item.type === 'consumable') {
    if (!invItem || invItem.quantity <= 0) return false;

    let refused = false;
    dispatchEntityScript(
      item.scriptId,
      'onUse',
      { player, item, itemId, refuse: () => void (refused = true) },
      item.scriptParams,
    );
    if (refused) return false;
    emit('itemUse', { player, itemId });
    const before = player.health;
    applyItemEffects(player, item.effects);
    recordHealthChange(player, player.health - before);
    removeItem(player.inventory, itemId, 1);
  } else {
    const slot = item.type as EquipmentSlot;
    const equippedItem = player.equipped[slot];

    if (!invItem && equippedItem === itemId) {
      unequipItem(player, slot);
    } else if (invItem) {
      equipItem(player, itemId);
    } else {
      logger.warn('[useItem] item not in inventory nor equipped');
      return false;
    }
  }

  updatePlayer(player);
  return true;
}

export function equipItem(player: PlayerServer, itemId: number): void {
  const item = getItemById(itemId);
  if (!item) return;

  const slot = item.type as EquipmentSlot;

  if (!EQUIPMENT_SLOTS.includes(slot)) {
    logger.warn('Invalid equip slot', { slot });
    return;
  }

  if (Number(player.equipped[slot]) === Number(itemId)) {
    unequipItem(player, slot);
    return;
  }

  if (player.equipped[slot]) {
    unequipItem(player, slot);
    // Unequip can refuse (a bound item, full inventory); never overwrite it.
    if (player.equipped[slot]) return;
  }

  player.equipped[slot] = itemId;

  removeItem(player.inventory, itemId, 1);

  // Copied, because unequipping must take off what went on here: by then the
  // definition may have been edited or deleted from the catalogue.
  const effects = item.effects?.map((effect) => ({ ...effect })) ?? [];
  (player.equippedEffects ??= {})[slot] = effects;
  applyItemEffects(player, effects);

  // Last, so a handler reading the player sees the item on and its effects
  // applied, the state it is being told about.
  emit('itemEquip', { player, itemId, slot });
  dispatchEntityScript(
    item.scriptId,
    'onEquip',
    { player, item, itemId, slot },
    item.scriptParams,
  );
}

export function unequipItem(player: PlayerServer, slot: EquipmentSlot): void {
  const itemId = player.equipped[slot];
  if (!itemId) return;

  // A bound item may never hit the ground: with no stack and no free slot the
  // fallback below would drop it, so refuse the unequip instead.
  const unequipped = getItemById(itemId);
  if (unequipped?.bound && !canFit(player.inventory, itemId)) return;

  // A slot with no record was filled without equipItem (a save older than the
  // records, a script, an admin edit), so the definition is all there is.
  // Such a slot still strands the bonus if its item is deleted
  // first; record it at login if old saves matter.
  applyItemEffects(
    player,
    player.equippedEffects?.[slot] ?? unequipped?.effects,
    true,
  );

  // A full inventory sends it to the ground rather than deleting it. Bound
  // items never get here, as the check above refuses the unequip.
  if (!addItem(player.inventory, itemId, 1).ok) {
    const map = getMap(player.mapId);
    if (unequipped && map) {
      map.droppedItems.push({
        itemId,
        sprite: unequipped.sprite,
        position: { ...player.position },
        quantity: 1,
      });
      updateMap(map);
    }
  }

  player.equipped[slot] = undefined;
  delete player.equippedEffects?.[slot];

  // After the slot is cleared, and only on the paths that got here: the refusal
  // above is not an unequip, and a listener told about one would take away a
  // bonus the player is still wearing.
  emit('itemUnequip', { player, itemId, slot });
  if (unequipped) {
    dispatchEntityScript(
      unequipped.scriptId,
      'onUnequip',
      { player, item: unequipped, itemId, slot },
      unequipped.scriptParams,
    );
  }
}

export function applyItemEffects(
  player: PlayerServer,
  effects: Effect[] | undefined,
  reverse = false,
): void {
  if (!effects) return;

  for (const effect of effects) {
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
