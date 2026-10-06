import { describe, it, expect, beforeEach } from 'vitest';
import { runInSandbox } from './sandbox.js';
import { clearAll, emit, on } from '../hooks.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { Direction, Key } from '../../../shared/types.js';
import { msToTicks } from '../../sim/clock.js';
import { seedRng, nextRandom } from '../../sim/rng.js';
import { config } from '../../config.js';
import { gameConfig, respawnPosition } from '../../gameConfig.js';
import {
  levelUpPlayer,
  awardExperience,
} from '../../services/player/playerService.js';
import { kvGet, clearKvStoreMemory } from '../../persistence/kvStore.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { drainGameEvents } from '../eventBus.js';
import { handleChatCommand, clearCommands } from '../commands.js';
import { Access } from '../../../shared/types.js';

beforeEach(() => {
  clearAll();
  clearKvStoreMemory();
  clearCommands();
  drainGameEvents();
});

// Trust model
//
// What the vm context does and does not guarantee: trusted scripting, not
// a security sandbox (see sandbox.ts).

describe('vm context - bare Node globals are not bound', () => {
  it('bare process is undefined inside a script', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice', health: 1, maxHealth: 100 });

    // Script checks typeof process; if it were defined it would heal the player.
    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        if (typeof process !== 'undefined') healPlayer(player);
      });
    `,
      'bare-process.js',
    );

    emit('playerJoin', { player });
    expect(player.health).toBe(1); // not healed - process not bound

    handle.cleanup();
  });

  it('bare require is undefined inside a script', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice', health: 1, maxHealth: 100 });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        if (typeof require !== 'undefined') healPlayer(player);
      });
    `,
      'bare-require.js',
    );

    emit('playerJoin', { player });
    expect(player.health).toBe(1); // not healed - require not bound

    handle.cleanup();
  });
});

describe('vm context - host objects ARE escapable (known trust boundary)', () => {
  it('a host object reaches the host realm via constructor.constructor', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice', health: 1, maxHealth: 100 });

    // The trust boundary: a passed-in host object reaches the host realm's
    // Function and so `process`. The escape is asserted so the limit stays
    // known; closing it (e.g. isolated-vm) means updating this test.
    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        const proc = player.constructor.constructor('return process')();
        if (proc && typeof proc.pid === 'number') healPlayer(player);
      });
    `,
      'escape.js',
    );

    emit('playerJoin', { player });
    expect(player.health).toBe(100); // escape succeeded - trusted model only

    handle.cleanup();
  });
});

describe('vm context - Math.random is the seeded sequence', () => {
  it('rolls what the engine would have rolled from the same seed', () => {
    createFixture(0);
    seedRng(42);
    const expected = [nextRandom(), nextRandom()];

    seedRng(42);
    const handle = runInSandbox(
      `
      store.set('rng', 'rolls', [Math.random(), Math.random()]);
      store.set('rng', 'intrinsic', Math.floor(2.7));
    `,
      'math-random.js',
    );

    expect(kvGet('rng', 'rolls')).toEqual(expected);
    // The rest of Math is the realm's own, untouched by the patch.
    expect(kvGet('rng', 'intrinsic')).toBe(2);

    handle.cleanup();
  });
});

// Core API

describe('hook registration', () => {
  it('script can register a hook via on() and it fires', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice', health: 1, maxHealth: 100 });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        healPlayer(player);
      });
    `,
      'test-hook.js',
    );

    emit('playerJoin', { player });
    expect(player.health).toBe(100); // hook fired and healed the player

    handle.cleanup();
  });

  it('cleanup unregisters all hooks registered by the script', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });

    const outerHandle = runInSandbox(
      `
      on('playerLevelUp', ({ player }) => {
        setPlayerData(player, 'outerFired', true);
      });
    `,
      'outer-track.js',
    );

    const innerHandle = runInSandbox(
      `
      on('playerLevelUp', ({ player }) => {
        setPlayerData(player, 'innerFired', true);
      });
    `,
      'inner-track.js',
    );

    innerHandle.cleanup();
    emit('playerLevelUp', { player, level: 5 });
    outerHandle.cleanup();

    expect(player.data?.outerFired).toBe(true); // outer hook still registered
    expect(player.data?.innerFired).toBeUndefined(); // inner hook was unregistered
  });
});

describe('hook error isolation', () => {
  it('a throwing hook handler does not propagate to emit caller', () => {
    const handle = runInSandbox(
      `
      on('playerLevelUp', () => { throw new Error('script bug'); });
    `,
      'error-script.js',
    );

    // Should not throw
    expect(() => {
      emit('playerLevelUp', { player: null as any, level: 2 });
    }).not.toThrow();

    handle.cleanup();
  });

  it('a throwing handler does not prevent other handlers from running', () => {
    const fired: boolean[] = [];

    const bad = runInSandbox(
      `
      on('playerLevelUp', () => { throw new Error('bad'); });
    `,
      'bad.js',
    );

    // Register a second hook from outside the sandbox, synchronously: a dynamic
    // import would resolve a microtask after the emit below and leave the
    // isolation this test is named for unchecked.
    on('playerLevelUp', () => fired.push(true));

    emit('playerLevelUp', { player: null as any, level: 2 });

    // The bad handler threw and emit carried on to this one.
    expect(fired).toEqual([true]);

    bad.cleanup();
  });
});

describe('init-time syntax error', () => {
  it('script with syntax error does not crash the loader', () => {
    expect(() => {
      const handle = runInSandbox(
        `this is not valid javascript !!!`,
        'bad-syntax.js',
      );
      handle.cleanup();
    }).not.toThrow();
  });
});

// Integration with game loop

describe('scripted levelUp hook via fixture', () => {
  it('fires when player levels up through the game loop', () => {
    const handle = runInSandbox(
      `
      on('playerLevelUp', ({ player, level }) => {
        setPlayerData(player, 'lastLevelUp', level);
      });
    `,
      'level-hook.js',
    );

    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    player.experience = 100;
    levelUpPlayer(player);

    handle.cleanup();
    expect(player.data?.lastLevelUp).toBe(player.level); // hook fired via the fixture's game loop
  });
});

describe('scripted npcDeath hook via fixture', () => {
  it('fires when player kills NPC without crashing', async () => {
    const handle = runInSandbox(
      `
      on('npcDeath', ({ npc, killer }) => {
        setPlayerData(killer, 'lastKill', npc.name);
      });
    `,
      'npc-death.js',
    );

    const sim = createFixture(0);
    sim.addNpc({
      name: 'Rat',
      behavior: 'aggressive',
      health: 1,
      maxHealth: 1,
      attack: 1,
      position: tile(5, 5),
      direction: Direction.Right,
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      attack: 999,
      position: tile(4, 5),
      direction: Direction.Right,
    });

    sim.press('Alice', Key.Control);
    sim.step(1);
    await Promise.resolve();

    handle.cleanup();
    expect(alice.data?.lastKill).toBe('Rat'); // hook fired with the killed NPC's name
  });
});

describe('scripted beforeDamage via fixture', () => {
  it('script can zero out incoming damage', () => {
    const handle = runInSandbox(
      `
      on('beforeDamage', ({ damage }) => { damage.value = 0; });
    `,
      'zero-damage.js',
    );

    const sim = createFixture(0);
    sim.addNpc({
      behavior: 'aggressive',
      attack: 9999,
      position: tile(5, 5),
      direction: Direction.Right,
    });
    const player = sim.addPlayer({
      name: 'Alice',
      health: 100,
      maxHealth: 100,
      position: tile(6, 5),
    });

    sim.step(msToTicks(900));

    // With 0 damage, player stays at full health
    expect(player.health).toBe(100);

    handle.cleanup();
  });
});

describe('outbound http', () => {
  // httpRequest has to reach the vm context, and since scripts fire it
  // without awaiting, a refused call must settle rather than reject.
  it('reaches a script, and a refused call settles instead of throwing', async () => {
    const results: unknown[] = [];
    const handle = runInSandbox(
      `
      on('playerJoin', () => {
        httpRequest('http://127.0.0.1/steal').then((res) => report(res));
      });
    `,
      'webhook.js',
      { report: (res: unknown) => results.push(res) },
    );

    emit('playerJoin', { player: createFixture(0).addPlayer({ name: 'A' }) });
    await new Promise((resolve) => setImmediate(resolve));

    expect(results[0]).toMatchObject({ ok: false, status: 0 });

    handle.cleanup();
  });
});

describe('API helpers', () => {
  it('giveItem adds the item to inventory', () => {
    const sim = createFixture(0);
    sim.addItem({
      id: 42,
      name: 'Gold',
      description: '',
      sprite: 0,
      type: 'money',
    });
    const player = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        giveItem(player, 42, 5);
      });
    `,
      'give-item.js',
    );

    emit('playerJoin', { player });

    const slot = player.inventory.items.find((i) => i.item === 42);
    expect(slot?.quantity).toBe(5);

    handle.cleanup();
  });

  it('removeItem reduces inventory quantity', () => {
    const sim = createFixture(0);
    sim.addItem({
      id: 7,
      name: 'Potion',
      description: '',
      sprite: 0,
      type: 'consumable',
      effects: [],
    });
    const player = sim.addPlayer({ name: 'Alice' });
    player.inventory.items.push({ item: 7, quantity: 3 });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        removeItem(player, 7, 2);
      });
    `,
      'remove-item.js',
    );

    emit('playerJoin', { player });

    const slot = player.inventory.items.find((i) => i.item === 7);
    expect(slot?.quantity).toBe(1);

    handle.cleanup();
  });

  it('healPlayer restores health to max', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice', health: 10, maxHealth: 100 });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        healPlayer(player);
      });
    `,
      'heal.js',
    );

    emit('playerJoin', { player });
    expect(player.health).toBe(100);

    handle.cleanup();
  });

  it('dealDamage kills a spawned NPC and emits npcDeath', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', experience: 0 });
    const deaths: string[] = [];
    on('npcDeath', ({ npc, killer }) =>
      deaths.push(`${killer.name}:${npc.name}`),
    );

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        const npc = spawnNpc({
          mapId: player.mapId,
          col: 5,
          row: 5,
          name: 'Training Dummy',
          maxHealth: 5,
          behavior: 'neutral',
        });
        npc.experienceValue = 7;
        dealDamage(npc, 5, player);
      });
    `,
      'deal-damage-npc.js',
    );

    emit('playerJoin', { player: alice });

    const npc = Object.values(sim.map.npcs).find(
      (n) => n.name === 'Training Dummy',
    );
    expect(deaths).toEqual(['Alice:Training Dummy']);
    expect(alice.experience).toBe(7);
    // It has no spawn tile to come back to.
    expect(npc).toBeUndefined();

    handle.cleanup();
  });

  it('dealDamage damages a player without requiring an attacker', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob', health: 40, maxHealth: 100 });
    const attackers: Array<string | undefined> = [];
    on('beforeDamage', ({ attacker }) => attackers.push(attacker?.id));

    const handle = runInSandbox(
      `
      on('playerJoin', () => {
        const target = getPlayer('Bob');
        dealDamage(target, 15);
      });
    `,
      'deal-damage-player.js',
    );

    emit('playerJoin', { player: alice });

    expect(bob.health).toBe(25);
    expect(attackers).toEqual([undefined]);

    handle.cleanup();
  });

  it('dealDamage applies strength and defense before hooks', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', strength: 7 });
    const bob = sim.addPlayer({
      name: 'Bob',
      defense: 3,
      health: 40,
      maxHealth: 100,
    });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        const target = getPlayer('Bob');
        dealDamage(target, 10, player);
      });
    `,
      'deal-damage-formula.js',
    );

    emit('playerJoin', { player: alice });

    expect(bob.health).toBe(26);

    handle.cleanup();
  });

  it('beforeDamage can still override formula damage', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', strength: 7 });
    const bob = sim.addPlayer({
      name: 'Bob',
      defense: 3,
      health: 40,
      maxHealth: 100,
    });
    on('beforeDamage', ({ damage }) => {
      damage.value = 2;
    });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        const target = getPlayer('Bob');
        dealDamage(target, 10, player);
      });
    `,
      'deal-damage-before-hook.js',
    );

    emit('playerJoin', { player: alice });

    expect(bob.health).toBe(38);

    handle.cleanup();
  });

  it('dealDamage can kill and respawn a player', () => {
    const sim = createFixture(0);
    sim.addMap({ id: gameConfig.world.startMapId });
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({
      name: 'Bob',
      health: 10,
      maxHealth: 100,
      position: tile(2, 2),
    });
    const deaths: string[] = [];
    on('playerDeath', ({ player, killer }) =>
      deaths.push(`${player.name}:${killer?.name ?? 'none'}`),
    );

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        const target = getPlayer('Bob');
        dealDamage(target, 10, player);
      });
    `,
      'deal-damage-player-lethal.js',
    );

    emit('playerJoin', { player: alice });

    expect(deaths).toEqual(['Bob:Alice']);
    expect(bob.health).toBe(100);
    expect(bob.position).toEqual(respawnPosition);
    expect(bob.mapId).toBe(gameConfig.world.startMapId);

    handle.cleanup();
  });

  it('dealDamage clamps negative and NaN damage', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', health: 40, maxHealth: 100 });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        dealDamage(player, -10);
        dealDamage(player, NaN);
      });
    `,
      'deal-damage-clamp.js',
    );

    emit('playerJoin', { player: alice });

    expect(alice.health).toBe(40);

    handle.cleanup();
  });

  it('setTimeout fires after the delay', async () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice', health: 50, maxHealth: 100 });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        setTimeout(() => { healPlayer(player); }, 10);
      });
    `,
      'timeout-heal.js',
    );

    emit('playerJoin', { player });
    expect(player.health).toBe(50); // not yet

    await new Promise((r) => setTimeout(r, 30));
    expect(player.health).toBe(100); // healed after timeout

    handle.cleanup();
  });

  it('cleanup cancels pending timers', async () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice', health: 50, maxHealth: 100 });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        setTimeout(() => { healPlayer(player); }, 10);
      });
    `,
      'timer-cancel.js',
    );

    emit('playerJoin', { player });
    handle.cleanup(); // cancel before timer fires

    await new Promise((r) => setTimeout(r, 30));
    expect(player.health).toBe(50); // timer was cancelled
  });
});

describe('getMapTile', () => {
  it('tells a script what is painted on the tile, not only whether it blocks', () => {
    const sim = createFixture(0);
    sim.map.tiles[2]![3] = { tileIndex: 5, maskIndex: 9, blocked: true };
    const player = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        setPlayerData(player, 'tile', getMapTile(player.mapId, 3, 2));
        setPlayerData(player, 'off', getMapTile(player.mapId, -1, 0));
      });
    `,
      'map-tile.js',
    );

    emit('playerJoin', { player });

    expect(player.data?.tile).toEqual({
      blocked: true,
      tileIndex: 5,
      maskIndex: 9,
    });
    expect(player.data?.off).toBeNull();

    handle.cleanup();
  });
});

describe('setMapTile', () => {
  it('changes what a tile shows and whether it blocks, and says so once', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    const changes: string[] = [];
    on('mapChange', ({ mapId }) => changes.push(mapId));

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        const door = { tileIndex: 77, blocked: true };
        setPlayerData(player, 'set', setMapTile(player.mapId, 3, 2, door));
        setPlayerData(player, 'again', setMapTile(player.mapId, 3, 2, door));
        setPlayerData(player, 'off', setMapTile(player.mapId, -1, 0, door));
      });
    `,
      'set-map-tile.js',
    );

    emit('playerJoin', { player });

    expect(sim.map.tiles[2]![3]).toMatchObject({
      tileIndex: 77,
      blocked: true,
    });
    expect(player.data).toMatchObject({ set: true, again: true, off: false });
    expect(changes).toEqual([sim.mapId]);
    sim.press('Alice', Key.ArrowRight);
    sim.step(10);
    expect(player.position).toEqual(tile(2, 2));

    handle.cleanup();
  });
});

describe('player data bag', () => {
  it('setPlayerData writes a value readable by getPlayerData', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        setPlayerData(player, 'vip', true);
        if (getPlayerData(player, 'vip')) setPlayerData(player, 'rank', 'gold');
      });
    `,
      'data-bag.js',
    );

    emit('playerJoin', { player });

    expect(player.data?.vip).toBe(true);
    expect(player.data?.rank).toBe('gold');

    handle.cleanup();
  });
});

describe('scoped KV store', () => {
  it('store.set persists to the shared store', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        store.set('guild:dragons', 'leader', player.name);
      });
    `,
      'store-set.js',
    );

    emit('playerJoin', { player });

    expect(kvGet('guild:dragons', 'leader')).toBe('Alice');

    handle.cleanup();
  });

  it('two scripts share state through the store', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });

    const writer = runInSandbox(
      `
      on('playerJoin', ({ player }) => { store.set('world', 'kills', 5); });
    `,
      'writer.js',
    );
    const reader = runInSandbox(
      `
      on('playerLevelUp', ({ player }) => {
        const k = store.get('world', 'kills');
        store.set('world', 'doubled', k * 2);
      });
    `,
      'reader.js',
    );

    emit('playerJoin', { player });
    emit('playerLevelUp', { player, level: 2 });

    expect(kvGet('world', 'doubled')).toBe(10);

    writer.cleanup();
    reader.cleanup();
  });
});

describe('VIP perks (vertical slice)', () => {
  it('a VIP script colors the name and doubles XP', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      experience: 0,
      experienceToNextLevel: 1000,
    });
    alice.data = { vip: true };
    const bob = sim.addPlayer({
      name: 'Bob',
      experience: 0,
      experienceToNextLevel: 1000,
    });

    const handle = runInSandbox(
      `
      on('playerJoin', ({ player }) => {
        if (getPlayerData(player, 'vip')) setNameColor(player, 'gold');
      });
      on('beforeXpGain', (ctx) => {
        if (getPlayerData(ctx.player, 'vip')) ctx.amount *= 2;
      });
    `,
      'vip.js',
    );

    emit('playerJoin', { player: alice });
    emit('playerJoin', { player: bob });

    // Cosmetic applied only to the VIP
    expect(alice.nameColor).toBe('gold');
    expect(bob.nameColor).toBeUndefined();

    // VIP gets double XP, non-VIP gets base
    awardExperience(alice, 50, 'kill');
    awardExperience(bob, 50, 'kill');
    expect(alice.experience).toBe(100);
    expect(bob.experience).toBe(50);

    handle.cleanup();
  });
});

describe('script-registered commands', () => {
  it('a script /vip command grants VIP from chat (admin only)', () => {
    const sim = createFixture(0);
    const admin = sim.addPlayer({ name: 'Admin', access: Access.ADMIN });
    const bob = sim.addPlayer({ name: 'Bob' });

    const handle = runInSandbox(
      `
      command('vip', { access: Access.ADMIN }, ({ args, reply }) => {
        const target = getPlayer(args[0]);
        if (!target) return reply('not found');
        setPlayerData(target, 'vip', true);
        setNameColor(target, 'gold');
        reply(target.name + ' is VIP');
      });
    `,
      'vip-cmd.js',
    );

    const handled = handleChatCommand(admin, '/vip Bob');

    expect(handled).toBe(true);
    expect(bob.data?.vip).toBe(true);
    expect(bob.nameColor).toBe('gold');

    handle.cleanup();
  });

  it('cleanup unregisters the script command', () => {
    const sim = createFixture(0);
    const admin = sim.addPlayer({ name: 'Admin', access: Access.ADMIN });
    const bob = sim.addPlayer({ name: 'Bob' });

    const handle = runInSandbox(
      `
      command('vip', { access: Access.ADMIN }, ({ args }) => {
        const t = getPlayer(args[0]);
        if (t) setPlayerData(t, 'vip', true);
      });
    `,
      'vip-cleanup.js',
    );

    handle.cleanup();
    handleChatCommand(admin, '/vip Bob');

    expect(bob.data?.vip).toBeUndefined(); // command no longer registered
  });
});

describe('custom network events (full loop through a script)', () => {
  it('receives a client custom action and replies with sendEvent', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });

    // Script: on a client "ping" action, reply to that player on "pong".
    const handle = runInSandbox(
      `
      on('customAction', ({ player, channel, payload }) => {
        if (channel === 'ping') sendEvent(player, 'pong', { echo: payload });
      });
    `,
      'ping-pong.js',
    );

    handleCustomAction({
      type: 'custom',
      username: 'Alice',
      channel: 'ping',
      payload: 42,
    });

    expect(drainGameEvents()).toEqual([
      {
        type: 'customPlayer',
        username: 'Alice',
        channel: 'pong',
        payload: { echo: 42 },
      },
    ]);

    handle.cleanup();
  });
});

describe('pet: spawnNpc + tick (vertical slice)', () => {
  it('a script spawns a pet that walks each tick', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(5, 5) });

    const handle = runInSandbox(
      `
      let pet = null;
      on('playerJoin', ({ player }) => {
        pet = spawnNpc({ mapId: player.mapId, col: 2, row: 5, name: 'Wolf', behavior: 'neutral' });
      });
      on('tick', () => {
        if (pet && pet.position.x < 9999) pet.position.x += 4; // walk east
      });
    `,
      'pet.js',
    );

    emit('playerJoin', { player: alice });

    const spawned = Object.values(sim.map.npcs).find((n) => n.name === 'Wolf');
    expect(spawned).toBeDefined();
    const startX = spawned!.position.x;

    sim.step(3);

    const pet = Object.values(sim.map.npcs).find((n) => n.name === 'Wolf')!;
    expect(pet.position.x).toBe(startX + 12); // moved 3 ticks

    handle.cleanup();
  });
});

describe('tick hook', () => {
  it('fires once per simulated tick', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    // A pet-like behavior: nudge a counter every tick (throttled to every 2).
    const handle = runInSandbox(
      `
      let n = 0;
      on('tick', ({ tick }) => {
        n++;
        setPlayerData(getPlayers()[0], 'ticks', n);
        if (tick % 2 === 0) setPlayerData(getPlayers()[0], 'evenHits', (getPlayerData(getPlayers()[0], 'evenHits') || 0) + 1);
      });
    `,
      'ticker.js',
    );

    sim.step(4);

    expect(alice.data?.ticks).toBe(4); // ran every tick
    expect(alice.data?.evenHits).toBeGreaterThan(0); // throttle pattern works

    handle.cleanup();
  });
});

describe('tick-based scheduling', () => {
  it('after runs the callback on the target tick', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      after(3, () => setPlayerData(getPlayers()[0], 'fired', true));
    `,
      'after.js',
    );

    sim.step(2);
    expect(alice.data?.fired).toBeUndefined();
    sim.step(1);
    expect(alice.data?.fired).toBe(true);

    handle.cleanup();
  });

  it('every repeats on its interval', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      every(2, () => {
        const p = getPlayers()[0];
        setPlayerData(p, 'n', (getPlayerData(p, 'n') || 0) + 1);
      });
    `,
      'every.js',
    );

    sim.step(6);
    expect(alice.data?.n).toBe(3);

    handle.cleanup();
  });

  it('cleanup cancels scheduled work, so a reloaded script does not double up', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      every(1, () => {
        const p = getPlayers()[0];
        setPlayerData(p, 'n', (getPlayerData(p, 'n') || 0) + 1);
      });
    `,
      'reloaded.js',
    );

    sim.step(2);
    expect(alice.data?.n).toBe(2);

    handle.cleanup();
    sim.step(5);
    expect(alice.data?.n).toBe(2);
  });

  it('cancel stops a task by id', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      const id = every(1, () => {
        const p = getPlayers()[0];
        setPlayerData(p, 'n', (getPlayerData(p, 'n') || 0) + 1);
      });
      after(2, () => cancel(id));
    `,
      'cancel.js',
    );

    sim.step(6);
    expect(alice.data?.n).toBe(2);

    handle.cleanup();
  });

  it('msToTicks converts using the server tick rate', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      setPlayerData(getPlayers()[0], 'ticks', msToTicks(1000));
      setPlayerData(getPlayers()[0], 'rate', TICK_RATE);
    `,
      'convert.js',
    );

    expect(alice.data?.ticks).toBe(msToTicks(1000));
    expect(alice.data?.rate).toBe(config.gameLoop.tickRate);

    handle.cleanup();
  });
});

describe('deterministic RNG in scripts', () => {
  it('random is seeded, so the same seed replays the same rolls', () => {
    function rollsWithSeed(seed: number): number[] {
      const sim = createFixture(seed);
      sim.addPlayer({ name: 'Alice' });
      const handle = runInSandbox(
        `
        const out = [];
        for (let i = 0; i < 5; i++) out.push(randomInt(1000));
        setPlayerData(getPlayers()[0], 'rolls', out);
      `,
        'rolls.js',
      );
      const rolls = sim.getPlayer('Alice').data?.rolls as number[];
      handle.cleanup();
      return rolls;
    }

    expect(rollsWithSeed(1234)).toEqual(rollsWithSeed(1234));
    expect(rollsWithSeed(1234)).not.toEqual(rollsWithSeed(5678));
  });

  it('exposes the rest of the rng helpers', () => {
    const sim = createFixture(7);
    const alice = sim.addPlayer({ name: 'Alice' });

    const handle = runInSandbox(
      `
      const p = getPlayers()[0];
      setPlayerData(p, 'unit', random());
      setPlayerData(p, 'always', randomChance(100));
      setPlayerData(p, 'never', randomChance(0));
      setPlayerData(p, 'pick', randomPick(['a']));
      setPlayerData(p, 'empty', randomPick([]));
    `,
      'rng.js',
    );

    expect(alice.data?.unit).toBeGreaterThanOrEqual(0);
    expect(alice.data?.unit).toBeLessThan(1);
    expect(alice.data?.always).toBe(true);
    expect(alice.data?.never).toBe(false);
    expect(alice.data?.pick).toBe('a');
    expect(alice.data?.empty).toBeUndefined();

    handle.cleanup();
  });
});
