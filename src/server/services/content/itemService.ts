import type { Item } from '../../../shared/types.js';
import ItemModel from '../../model/Item.js';
import { getNextItemId } from '../dbService.js';
import { forgetSentItem } from '../../net/snapshot.js';
import { sweepUnclaimableDeliveries } from '../economy/deliveryService.js';

// Every item definition, loaded at boot. Read on pick-up, use, equip and every
// snapshot that names an item, all inside the tick, where a database round
// trip is not an option.
export const items = new Map<number, Item>();

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
