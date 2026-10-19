import { describe, it, expect } from 'vitest';
import { ItemSchema } from './itemService.js';

describe('ItemSchema', () => {
  it('accepts valid item', () => {
    expect(
      ItemSchema.safeParse({
        name: 'Sword',
        sprite: 0,
        type: 'weapon',
      }).success,
    ).toBe(true);
  });
  it('rejects invalid item type', () => {
    expect(
      ItemSchema.safeParse({ name: 'X', sprite: 0, type: 'trash' }).success,
    ).toBe(false);
  });
  it('defaults description to empty string', () => {
    const result = ItemSchema.safeParse({
      name: 'X',
      sprite: 0,
      type: 'consumable',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe('');
  });
});
