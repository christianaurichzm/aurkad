import { z } from 'zod';
import type {
  EffectType,
  Item,
  ItemType,
  ModifiablePlayerAttribute,
} from '../../../shared/types.js';
import ItemModel from '../../model/Item.js';
import { getNextItemId, unsetAbsent } from '../dbService.js';
import { forgetSentItem } from '../../net/viewerState.js';
import { sweepUnclaimableDeliveries } from '../economy/deliveryService.js';
import { EQUIPMENT_SLOTS } from '../../../shared/constants.js';
import { ScriptParamsSchema } from '../../../shared/scriptParams.js';

const ITEM_TYPE_TUPLE = [...EQUIPMENT_SLOTS, 'consumable', 'money'] as const;
const ItemTypeSchema = z.enum(
  ITEM_TYPE_TUPLE as unknown as [ItemType, ...ItemType[]],
);

const MODIFIABLE_ATTRS = [
  'health',
  'maxHealth',
  'attack',
  'strength',
  'defense',
  'agility',
  'vitality',
  'speed',
  'attackRange',
  'experience',
  'experienceToNextLevel',
  'level',
] as const;
const EFFECT_TYPES = ['add', 'multiply'] as const;

const EffectSchema = z.object({
  attribute: z.enum(
    MODIFIABLE_ATTRS as unknown as [
      ModifiablePlayerAttribute,
      ...ModifiablePlayerAttribute[],
    ],
  ),
  type: z.enum(EFFECT_TYPES as unknown as [EffectType, ...EffectType[]]),
  value: z.number(),
});

export const ItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  sprite: z.number().int().nonnegative(),
  type: ItemTypeSchema,
  effects: z.array(EffectSchema).optional(),
  arrowId: z.number().int().positive().optional(),
  bound: z.boolean().optional(),
  scriptId: z.string().optional(),
  scriptParams: ScriptParamsSchema.optional(),
});

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
    { $set: item, ...unsetAbsent(ItemSchema, item) },
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
