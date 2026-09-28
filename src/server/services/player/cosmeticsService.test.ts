import { describe, it, expect } from 'vitest';
import { setCosmetic, clearCosmetic } from './cosmeticsService.js';
import {
  CharacterAction,
  Direction,
  PlayerServer,
} from '../../../shared/types.js';

function mkPlayer(): PlayerServer {
  return {
    id: 'p1',
    name: 'P',
    sprite: 0,
    width: 64,
    height: 64,
    maxHealth: 100,
    attack: 10,
    attackRange: 64,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    inventory: { items: [], maxCapacity: 10 },
    equipped: {},
    access: 0,
    strength: 0,
    defense: 0,
    agility: 0,
    vitality: 0,
    unspentPoints: 0,
    speed: 1,
    mapId: '1',
    position: { x: 0, y: 0 },
    direction: Direction.Down,
    action: CharacterAction.Idle,
    health: 100,
    kind: 'player',
  };
}

describe('derived cosmetics', () => {
  it('a single source resolves to its value', () => {
    const p = mkPlayer();
    setCosmetic(p, 'nameColor', 'vip', 'gold');
    expect(p.nameColor).toBe('gold');
  });

  it('higher priority wins over a lower-priority source', () => {
    const p = mkPlayer();
    setCosmetic(p, 'nameColor', 'vip', 'gold', 0);
    setCosmetic(p, 'nameColor', 'pk', 'red', 10);
    expect(p.nameColor).toBe('red');
  });

  it('clearing the winner falls back to the next highest', () => {
    const p = mkPlayer();
    setCosmetic(p, 'nameColor', 'vip', 'gold', 0);
    setCosmetic(p, 'nameColor', 'pk', 'red', 10);
    clearCosmetic(p, 'nameColor', 'pk');
    expect(p.nameColor).toBe('gold');
  });

  it('clearing the last source resets the field to undefined', () => {
    const p = mkPlayer();
    setCosmetic(p, 'nameColor', 'vip', 'gold');
    clearCosmetic(p, 'nameColor', 'vip');
    expect(p.nameColor).toBeUndefined();
  });

  it('fields are independent (nameColor vs nameTag)', () => {
    const p = mkPlayer();
    setCosmetic(p, 'nameColor', 'vip', 'gold');
    setCosmetic(p, 'nameTag', 'guild', '[Dragons]');
    expect(p.nameColor).toBe('gold');
    expect(p.nameTag).toBe('[Dragons]');
  });

  it("a tag's colour goes with the tag that wins", () => {
    const p = mkPlayer();
    setCosmetic(p, 'nameTag', 'base', 'Rootbreaker', 0, 'purple');
    expect(p.nameTagColor).toBe('purple');
    setCosmetic(p, 'nameTag', 'guild', '[Dragons]', 5);
    expect(p.nameTag).toBe('[Dragons]');
    expect(p.nameTagColor).toBeUndefined();
    clearCosmetic(p, 'nameTag', 'guild');
    expect(p.nameTagColor).toBe('purple');
  });

  it('re-setting the same source updates its value', () => {
    const p = mkPlayer();
    setCosmetic(p, 'nameTag', 'guild', '[Dragons]');
    setCosmetic(p, 'nameTag', 'guild', '[Phoenix]');
    expect(p.nameTag).toBe('[Phoenix]');
  });
});
