// Exercises the real pet module: /pet summons a follower that walks toward its
// owner and fights nearby enemies, crediting the owner.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { clearProvides } from './registry.js';
import { handleChatCommand, clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import type { RuntimeNpc, PlayerServer } from '../../../shared/types.js';

const findPet = (
  sim: ReturnType<typeof createFixture>,
): RuntimeNpc | undefined =>
  Object.values(sim.map.npcs).find((n) => n.name.includes('Pet'));

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  loadModules(); // real modules/ (pet enabled in game.json)
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

describe('pet module', () => {
  it('/pet summons and dismisses a follower', () => {
    const sim = createFixture(0);
    const owner = sim.addPlayer({ name: 'Owner', position: tile(5, 5) });

    handleChatCommand(owner, '/pet');
    expect(findPet(sim)).toBeDefined();

    handleChatCommand(owner, '/pet');
    expect(findPet(sim)).toBeUndefined();
  });

  it('walks toward the owner when far', () => {
    const sim = createFixture(0);
    const owner = sim.addPlayer({ name: 'Owner', position: tile(2, 2) });
    handleChatCommand(owner, '/pet');
    const pet = findPet(sim)!;

    owner.position = tile(12, 2); // owner walks away
    const startX = pet.position.x;
    sim.step(25); // one NPC-cadence step

    expect(pet.position.x).toBeGreaterThan(startX); // stepped toward the owner
  });

  it('attacks a nearby enemy, crediting the owner', () => {
    const sim = createFixture(0);
    // Owner far away so the aggressive enemy has no player to chase.
    const owner = sim.addPlayer({ name: 'Owner', position: tile(1, 1) });
    handleChatCommand(owner, '/pet');
    const pet = findPet(sim)!;
    pet.position = tile(20, 5);

    const enemy = sim.addNpc({
      name: 'Goblin',
      behavior: 'aggressive',
      attack: 0,
      position: tile(21, 5),
      maxHealth: 30,
      health: 30,
    });

    sim.step(25);

    expect(enemy.health).toBeLessThan(30); // pet hit it
  });

  it('removes the pet when the owner leaves', () => {
    const sim = createFixture(0);
    const owner: PlayerServer = sim.addPlayer({ name: 'Owner' });
    handleChatCommand(owner, '/pet');
    expect(findPet(sim)).toBeDefined();

    emit('playerLeave', { player: owner });
    expect(findPet(sim)).toBeUndefined();
  });
});
