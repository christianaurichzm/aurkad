import { z } from 'zod';
import SpellModel from '../../model/Spell.js';
import type { Spell } from '../../../shared/types.js';

/**
 * What a spell has to be to reach the database. In the service because the
 * scripting API writes spells too, and a rule beside one caller is one the
 * other walks past. Every content write is an upsert, which skips the
 * model's validators, so the model's `min: 0` never runs on this path.
 */
export const SpellSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  sprite: z.number().int().nonnegative(),
  mpCost: z.number().int().nonnegative().default(0),
  damage: z.number().int().nonnegative().default(0),
  cooldownMs: z.number().int().nonnegative().default(0),
  target: z.enum(['enemies', 'self', 'party', 'guild']).default('enemies'),
  heal: z.number().int().nonnegative().default(0),
  frames: z.number().int().min(1).default(1),
  visualTarget: z.enum(['self', 'targets']).default('self'),
  // Null, not absent, for "none": a save is an upsert, and a field left out
  // of one keeps the icon it is meant to clear.
  icon: z.number().int().nonnegative().nullable().default(null),
});

export type SpellInput = z.input<typeof SpellSchema>;

const spells = new Map<number, Spell>();

export async function loadSpells(): Promise<void> {
  const docs = await SpellModel.find().lean<Spell[]>().exec();
  spells.clear();
  for (const s of docs) spells.set(s.id, s);
}

export async function listSpells(): Promise<Spell[]> {
  return SpellModel.find().lean<Spell[]>().exec();
}

export async function createOrUpdateSpell(
  spell: SpellInput & { id?: number },
): Promise<Spell> {
  const parsed = SpellSchema.safeParse(spell);
  if (!parsed.success) {
    // Flattened into the message so a caller with no form, the script API
    // that logs it, still says which field and why.
    const why = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'spell'}: ${i.message}`)
      .join(', ');
    throw new Error(`Invalid spell: ${why}`);
  }

  let id = spell.id;
  if (id === undefined) {
    const max = await SpellModel.findOne()
      .sort({ id: -1 })
      .lean<Spell>()
      .exec();
    id = (max?.id ?? 0) + 1;
  }
  const result = await SpellModel.findOneAndUpdate(
    { id },
    { ...parsed.data, id },
    { upsert: true, returnDocument: 'after' },
  )
    .lean<Spell>()
    .exec();
  spells.set(id, result);
  return result;
}

export async function deleteSpell(id: number): Promise<void> {
  await SpellModel.deleteOne({ id });
  spells.delete(id);
}

export function getSpellSync(id: number): Spell | undefined {
  return spells.get(id);
}

export function getAllSpells(): Spell[] {
  return [...spells.values()];
}
