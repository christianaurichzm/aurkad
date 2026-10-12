import type { Item } from '../../../shared/types.js';
import ItemModel from '../../model/Item.js';
import { getNextItemId } from '../dbService.js';
import { forgetSentItem } from '../../net/snapshot.js';
import { sweepUnclaimableDeliveries } from '../economy/deliveryService.js';
import { CreateItemBodySchema, unsetAbsent } from '../../http/bodySchemas.js';

// Every item definition, loaded at boot. Read on pick-up, use, equip and every
// snapshot that names an item, all inside the tick, where a database round
// trip is not an option.
export const items = new Map<number, Item>();

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
  // Every caller passes a complete item (editor form, content import), which is
  // why the cache line below replaces the entry wholesale; the stored document
  // has to lose what the item left out too.
  await ItemModel.findOneAndUpdate(
    { id },
    { $set: item, ...unsetAbsent(CreateItemBodySchema, item) },
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
