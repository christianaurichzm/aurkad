import SpellModel from '../../model/Spell.js';
import type { Spell } from '../../../shared/types.js';

const spells = new Map<number, Spell>();

export async function loadSpells(): Promise<void> {
  const docs = await SpellModel.find().lean<Spell[]>().exec();
  spells.clear();
  for (const s of docs) spells.set(s.id, s);
}

export async function listSpells(): Promise<Spell[]> {
  return SpellModel.find().lean<Spell[]>().exec();
}

export async function getSpellById(id: number): Promise<Spell | null> {
  return SpellModel.findOne({ id }).lean<Spell>().exec();
}

export async function createOrUpdateSpell(
  spell: Omit<Spell, 'id'> & { id?: number },
): Promise<Spell> {
  if (spell.id === undefined) {
    const max = await SpellModel.findOne()
      .sort({ id: -1 })
      .lean<Spell>()
      .exec();
    spell.id = (max?.id ?? 0) + 1;
  }
  const result = await SpellModel.findOneAndUpdate({ id: spell.id }, spell, {
    upsert: true,
    new: true,
  })
    .lean<Spell>()
    .exec();
  spells.set(spell.id, result!);
  return result!;
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
