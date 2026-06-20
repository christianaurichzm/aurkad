import { describe, it, expect } from 'vitest';
import { PlayerRecord } from '../../shared/types.js';
import { DEFAULT_INVENTORY_CAPACITY } from '../../shared/constants.js';
import { normalizePlayerRecord } from './playerRepository.js';

function mkRecord(overrides: Partial<PlayerRecord>): PlayerRecord {
  return {
    id: 'p1',
    name: 'P',
    password: 'hash',
    ...overrides,
  } as unknown as PlayerRecord;
}

describe('normalizePlayerRecord', () => {
  it('fills equipped and inventory dropped by mongoose minimize', () => {
    const record = mkRecord({
      equipped: undefined as unknown as PlayerRecord['equipped'],
      inventory: undefined as unknown as PlayerRecord['inventory'],
    });

    const normalized = normalizePlayerRecord(record);

    expect(normalized.equipped).toEqual({});
    expect(normalized.inventory).toEqual({
      items: [],
      maxCapacity: DEFAULT_INVENTORY_CAPACITY,
    });
  });

  it('keeps existing equipped and inventory', () => {
    const record = mkRecord({
      equipped: { weapon: 2 },
      inventory: { items: [{ item: 1, quantity: 3 }], maxCapacity: 5 },
    });

    const normalized = normalizePlayerRecord(record);

    expect(normalized.equipped).toEqual({ weapon: 2 });
    expect(normalized.inventory.maxCapacity).toBe(5);
  });
});
