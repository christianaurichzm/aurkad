import { describe, it, expect, beforeEach } from 'vitest';
import { CharacterAction } from '../../shared/types.js';
import { TILE_SIZE } from '../../shared/constants.js';
import { buyShopItem } from '../services/shopService.js';
import { useItem, equipItem } from '../services/inventoryService.js';
import { changeSprite } from '../services/playerService.js';
import { updatePlayerMap } from '../services/mapService.js';
import {
  getPlayerByName,
  getAllPlayers,
  unregisterPlayer,
} from '../sim/world.js';
import { createFixture } from './simFixture.js';

let sim: ReturnType<typeof createFixture>;

beforeEach(() => {
  sim = createFixture(0);
});

// Shop

describe('shop', () => {
  it('deducts currency and adds item to inventory on purchase', async () => {
    const coin = {
      id: 10,
      name: 'Coin',
      description: '',
      sprite: 0,
      type: 'money' as const,
    };
    const sword = {
      id: 20,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon' as const,
    };
    sim.addItem(coin);
    sim.addItem(sword);

    const player = sim.addPlayer({ name: 'Alice' });
    player.inventory.items.push({ item: 10, quantity: 5 });

    const shop = {
      id: 's1',
      name: 'Shop',
      products: [{ itemId: 20, currency: 10, price: 3 }],
    };

    const ok = await buyShopItem(player, 20, shop as any);

    expect(ok).toBe(true);
    expect(player.inventory.items.find((i) => i.item === 20)?.quantity).toBe(1);
    expect(player.inventory.items.find((i) => i.item === 10)?.quantity).toBe(2);
  });

  it('refuses purchase when player has insufficient currency', async () => {
    const coin = {
      id: 10,
      name: 'Coin',
      description: '',
      sprite: 0,
      type: 'money' as const,
    };
    const sword = {
      id: 20,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon' as const,
    };
    sim.addItem(coin);
    sim.addItem(sword);

    const player = sim.addPlayer({ name: 'Alice' });
    player.inventory.items.push({ item: 10, quantity: 1 });

    const shop = {
      id: 's1',
      name: 'Shop',
      products: [{ itemId: 20, currency: 10, price: 5 }],
    };

    const ok = await buyShopItem(player, 20, shop as any);

    expect(ok).toBe(false);
    expect(player.inventory.items.find((i) => i.item === 20)).toBeUndefined();
    expect(player.inventory.items.find((i) => i.item === 10)?.quantity).toBe(1);
  });

  it('stacks item quantity if already owned', async () => {
    const coin = {
      id: 10,
      name: 'Coin',
      description: '',
      sprite: 0,
      type: 'money' as const,
    };
    const potion = {
      id: 30,
      name: 'Potion',
      description: '',
      sprite: 0,
      type: 'consumable' as const,
    };
    sim.addItem(coin);
    sim.addItem(potion);

    const player = sim.addPlayer({ name: 'Alice' });
    player.inventory.items.push({ item: 10, quantity: 10 });
    player.inventory.items.push({ item: 30, quantity: 2 });

    const shop = {
      id: 's1',
      name: 'Shop',
      products: [{ itemId: 30, currency: 10, price: 2 }],
    };

    await buyShopItem(player, 30, shop as any);

    expect(player.inventory.items.find((i) => i.item === 30)?.quantity).toBe(3);
  });
});

// Inventory: equip and use

describe('inventory', () => {
  it('equipping a weapon moves it to the equipped slot and applies stat effects', async () => {
    const sword = {
      id: 20,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon' as const,
      effects: [
        { attribute: 'attack' as const, type: 'add' as const, value: 15 },
      ],
    };
    sim.addItem(sword);

    const player = sim.addPlayer({ name: 'Alice', attack: 10 });
    player.inventory.items.push({ item: 20, quantity: 1 });

    await equipItem(player, 20);

    expect(player.equipped['weapon']).toBe(20);
    expect(player.inventory.items.find((i) => i.item === 20)).toBeUndefined();
    expect(player.attack).toBe(25);
  });

  it('equipping same weapon again unequips it and returns to inventory', async () => {
    const sword = {
      id: 20,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon' as const,
      effects: [
        { attribute: 'attack' as const, type: 'add' as const, value: 15 },
      ],
    };
    sim.addItem(sword);

    const player = sim.addPlayer({ name: 'Alice', attack: 10 });
    player.inventory.items.push({ item: 20, quantity: 1 });

    await equipItem(player, 20);
    await equipItem(player, 20);

    expect(player.equipped['weapon']).toBeUndefined();
    expect(player.inventory.items.find((i) => i.item === 20)?.quantity).toBe(1);
    expect(player.attack).toBe(10);
  });

  it('using a consumable restores health and reduces quantity', async () => {
    const potion = {
      id: 30,
      name: 'Potion',
      description: '',
      sprite: 0,
      type: 'consumable' as const,
      effects: [
        { attribute: 'health' as const, type: 'add' as const, value: 30 },
      ],
    };
    sim.addItem(potion);

    const player = sim.addPlayer({ name: 'Alice', health: 50, maxHealth: 100 });
    player.inventory.items.push({ item: 30, quantity: 3 });

    await useItem('Alice', 30);

    expect(player.health).toBe(80);
    expect(player.inventory.items.find((i) => i.item === 30)?.quantity).toBe(2);
  });

  it('using the last consumable removes it from inventory entirely', async () => {
    const potion = {
      id: 30,
      name: 'Potion',
      description: '',
      sprite: 0,
      type: 'consumable' as const,
      effects: [
        { attribute: 'health' as const, type: 'add' as const, value: 10 },
      ],
    };
    sim.addItem(potion);

    const player = sim.addPlayer({ name: 'Alice', health: 80, maxHealth: 100 });
    player.inventory.items.push({ item: 30, quantity: 1 });

    await useItem('Alice', 30);

    expect(player.inventory.items.find((i) => i.item === 30)).toBeUndefined();
  });
});

// Mod actions

describe('mod actions', () => {
  it('bring: teleports target to the mod position on the same map', () => {
    const mod = sim.addPlayer({
      name: 'Mod',
      position: { x: 8 * TILE_SIZE, y: 8 * TILE_SIZE },
    });
    const target = sim.addPlayer({
      name: 'Bob',
      position: { x: 2 * TILE_SIZE, y: 2 * TILE_SIZE },
    });

    // replicate /mod/bring route logic
    const prevMap = target.mapId;
    target.position = { ...mod.position };
    target.mapId = mod.mapId;
    target.targetPosition = undefined;
    target.moving = false;
    target.action = CharacterAction.Idle;
    target.moveTick = undefined;
    target.moveDurationTicks = undefined;
    updatePlayerMap(target.id, target, prevMap);

    expect(target.position).toEqual(mod.position);
    expect(target.mapId).toBe(mod.mapId);
  });

  it('goto: mod teleports to the target position on the target map', () => {
    const map2 = sim.addMap({ id: 'map2' });
    const mod = sim.addPlayer({
      name: 'Mod',
      position: { x: 1 * TILE_SIZE, y: 1 * TILE_SIZE },
    });
    const target = sim.addPlayer({
      name: 'Bob',
      position: { x: 7 * TILE_SIZE, y: 7 * TILE_SIZE },
      mapId: map2.id,
    });
    map2.players[target.id] = target;

    // replicate /mod/goto route logic
    const prevMap = mod.mapId;
    mod.position = { ...target.position };
    mod.mapId = target.mapId;
    mod.targetPosition = undefined;
    mod.moving = false;
    mod.action = CharacterAction.Idle;
    mod.moveTick = undefined;
    mod.moveDurationTicks = undefined;
    updatePlayerMap(mod.id, mod, prevMap);

    expect(mod.position).toEqual(target.position);
    expect(mod.mapId).toBe(map2.id);
  });

  it('setSprite: changes the target player sprite', () => {
    sim.addPlayer({ name: 'Bob', sprite: 0 });

    // replicate /mod/setSprite route logic
    changeSprite(5, 'Bob');

    expect(getPlayerByName('Bob')!.sprite).toBe(5);
  });

  it('kick: removing a player from the world makes them unreachable by name', () => {
    // disconnectPlayer also persists to MongoDB, which is not available in sim
    // tests. unregisterPlayer is the in-memory half that all kick/ban paths go
    // through, so we test it directly.
    const alice = sim.addPlayer({ name: 'Alice' });
    sim.addPlayer({ name: 'Bob' });

    expect(getAllPlayers()).toHaveLength(2);

    unregisterPlayer(alice.id);

    expect(getAllPlayers()).toHaveLength(1);
    expect(getPlayerByName('Alice')).toBeUndefined();
  });
});
