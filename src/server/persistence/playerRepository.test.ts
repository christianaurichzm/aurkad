import { describe, it, expect } from 'vitest';
import { PlayerRecord } from '../../shared/types.js';
import { gameConfig } from '../gameConfig.js';
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
      equipped: undefined,
      inventory: undefined,
      strength: undefined,
      defense: undefined,
      agility: undefined,
    });

    const normalized = normalizePlayerRecord(record);

    expect(normalized.strength).toBe(gameConfig.player.startingStrength);
    expect(normalized.defense).toBe(gameConfig.player.startingDefense);
    expect(normalized.agility).toBe(gameConfig.player.startingAgility);
    expect(normalized.equipped).toEqual({});
    expect(normalized.inventory).toEqual({
      items: [],
      maxCapacity: gameConfig.player.startingInventoryCapacity,
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
