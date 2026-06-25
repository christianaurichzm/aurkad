import ArrowModel from '../model/Arrow.js';
import type { Arrow } from '../../shared/types.js';

const arrows = new Map<number, Arrow>();

export async function loadArrows(): Promise<void> {
  const docs = await ArrowModel.find().lean<Arrow[]>().exec();
  arrows.clear();
  for (const a of docs) arrows.set(a.id, a);
}

export async function listArrows(): Promise<Arrow[]> {
  return ArrowModel.find().lean<Arrow[]>().exec();
}

export async function getArrowById(id: number): Promise<Arrow | null> {
  return ArrowModel.findOne({ id }).lean<Arrow>().exec();
}

export async function createOrUpdateArrow(
  arrow: Omit<Arrow, 'id'> & { id?: number },
): Promise<Arrow> {
  if (arrow.id === undefined) {
    const max = await ArrowModel.findOne()
      .sort({ id: -1 })
      .lean<Arrow>()
      .exec();
    arrow.id = (max?.id ?? 0) + 1;
  }
  const result = await ArrowModel.findOneAndUpdate({ id: arrow.id }, arrow, {
    upsert: true,
    new: true,
  })
    .lean<Arrow>()
    .exec();
  arrows.set(arrow.id, result!);
  return result!;
}

export async function deleteArrow(id: number): Promise<void> {
  await ArrowModel.deleteOne({ id });
  arrows.delete(id);
}
