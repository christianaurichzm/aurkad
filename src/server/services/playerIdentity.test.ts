import { describe, it, expect } from 'vitest';
import { createFixture } from '../sim/simFixture.js';
import { handlePlayerUpdate } from './gameService.js';
import { getPlayerByName } from '../sim/world.js';

// handlePlayerUpdate must not swap the registered player object's identity.
// A reference held elsewhere (in-flight combat, a script, an async op
// mid-await) would otherwise be detached, and its later mutations lost.

describe('handlePlayerUpdate identity (F-4)', () => {
  it('keeps the registered object identity stable across an update', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', sprite: 0 });
    const held = getPlayerByName('Alice');

    handlePlayerUpdate({ ...alice, sprite: 7 });

    const after = getPlayerByName('Alice');
    expect(after?.sprite).toBe(7);
    expect(after).toBe(held);
  });

  it('does not detach a reference held before the update', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const held = getPlayerByName('Alice')!;

    handlePlayerUpdate({ ...alice, sprite: 9 });

    // A mutation through the pre-update reference must still be visible via
    // the registry, as they have to be the same object.
    held.health = 42;
    expect(getPlayerByName('Alice')?.health).toBe(42);
  });

  it('map.players and the name index resolve to the same object after update', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    handlePlayerUpdate({ ...alice, sprite: 3 });

    const byName = getPlayerByName('Alice');
    expect(sim.map.players[alice.id]).toBe(byName);
  });
});
