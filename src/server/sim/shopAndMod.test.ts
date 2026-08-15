import { describe, it, expect, beforeEach } from 'vitest';
import { CharacterAction } from '../../shared/types.js';
import { buyShopItem } from '../services/economy/shopService.js';
import {
  useItem,
  equipItem,
  dropItemFromInventory,
  pickUpItem,
} from '../services/economy/inventoryService.js';
import { changeSprite } from '../services/player/playerService.js';
import { updatePlayerMap } from '../services/world/mapService.js';
import {
  getPlayerByName,
  getAllPlayers,
  unregisterPlayer,
} from '../sim/world.js';
import { createFixture, tile } from './simFixture.js';

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
  it('equipping a weapon moves it to the equipped slot and applies stat effects', () => {
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

    equipItem(player, 20);

    expect(player.equipped['weapon']).toBe(20);
    expect(player.inventory.items.find((i) => i.item === 20)).toBeUndefined();
    expect(player.attack).toBe(25);
  });

  it('equipping same weapon again unequips it and returns to inventory', () => {
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

    equipItem(player, 20);
    equipItem(player, 20);

    expect(player.equipped['weapon']).toBeUndefined();
    expect(player.inventory.items.find((i) => i.item === 20)?.quantity).toBe(1);
    expect(player.attack).toBe(10);
  });

  it('using a consumable restores health and reduces quantity', () => {
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

    useItem('Alice', 30);

    expect(player.health).toBe(80);
    expect(player.inventory.items.find((i) => i.item === 30)?.quantity).toBe(2);
  });

  it('using the last consumable removes it from inventory entirely', () => {
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

    useItem('Alice', 30);

    expect(player.inventory.items.find((i) => i.item === 30)).toBeUndefined();
  });

  it('dropping part of a stack creates a single stacked drop on the map', () => {
    const potion = {
      id: 30,
      name: 'Potion',
      description: '',
      sprite: 4,
      type: 'consumable' as const,
    };
    sim.addItem(potion);

    const player = sim.addPlayer({ name: 'Alice' });
    player.inventory.items.push({ item: 30, quantity: 5 });

    const ok = dropItemFromInventory('Alice', 30, 3);

    expect(ok).toBe(true);
    expect(player.inventory.items.find((i) => i.item === 30)?.quantity).toBe(2);
    expect(sim.map.droppedItems).toHaveLength(1);
    expect(sim.map.droppedItems[0]).toEqual(
      expect.objectContaining({
        itemId: 30,
        sprite: 4,
        quantity: 3,
        position: player.position,
      }),
    );
  });

  it('equipping a weapon with a multiply effect scales the stat', () => {
    const sword = {
      id: 21,
      name: 'PowerSword',
      description: '',
      sprite: 0,
      type: 'weapon' as const,
      effects: [
        { attribute: 'attack' as const, type: 'multiply' as const, value: 1.5 },
      ],
    };
    sim.addItem(sword);

    const player = sim.addPlayer({ name: 'Bob', attack: 10 });
    player.inventory.items.push({ item: 21, quantity: 1 });

    equipItem(player, 21);

    expect(player.attack).toBe(15);
  });

  it('unequipping a multiply-effect weapon restores original stat exactly', () => {
    const sword = {
      id: 21,
      name: 'PowerSword',
      description: '',
      sprite: 0,
      type: 'weapon' as const,
      effects: [
        { attribute: 'attack' as const, type: 'multiply' as const, value: 1.5 },
      ],
    };
    sim.addItem(sword);

    const player = sim.addPlayer({ name: 'Bob', attack: 10 });
    player.inventory.items.push({ item: 21, quantity: 1 });

    equipItem(player, 21);
    equipItem(player, 21);

    expect(player.attack).toBe(10);
  });

  it('swapping equipped weapon unequips old and equips new', () => {
    const sword = {
      id: 20,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon' as const,
      effects: [
        { attribute: 'attack' as const, type: 'add' as const, value: 5 },
      ],
    };
    const axe = {
      id: 22,
      name: 'Axe',
      description: '',
      sprite: 0,
      type: 'weapon' as const,
      effects: [
        { attribute: 'attack' as const, type: 'add' as const, value: 20 },
      ],
    };
    sim.addItem(sword);
    sim.addItem(axe);

    const player = sim.addPlayer({ name: 'Charlie', attack: 10 });
    player.inventory.items.push({ item: 20, quantity: 1 });
    player.inventory.items.push({ item: 22, quantity: 1 });

    equipItem(player, 20);
    expect(player.attack).toBe(15);
    expect(player.equipped['weapon']).toBe(20);

    equipItem(player, 22);
    expect(player.equipped['weapon']).toBe(22);
    expect(player.attack).toBe(30);
    expect(player.inventory.items.find((i) => i.item === 20)?.quantity).toBe(1);
  });

  it('picking up a stacked drop recovers the whole quantity at once', () => {
    sim.addItem({
      id: 31,
      name: 'Arrow',
      description: '',
      sprite: 9,
      type: 'consumable' as const,
    });

    const player = sim.addPlayer({ name: 'Alice' });
    sim.map.droppedItems.push({
      itemId: 31,
      sprite: 9,
      position: { ...player.position },
      quantity: 7,
    });

    pickUpItem(sim.map, player);

    expect(player.inventory.items.find((i) => i.item === 31)?.quantity).toBe(7);
    expect(sim.map.droppedItems).toHaveLength(0);
  });
});

// Mod actions

describe('mod actions', () => {
  it('bring: teleports target to the mod position on the same map', () => {
    const mod = sim.addPlayer({ name: 'Mod', position: tile(8, 8) });
    const target = sim.addPlayer({ name: 'Bob', position: tile(2, 2) });

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
    const mod = sim.addPlayer({ name: 'Mod', position: tile(1, 1) });
    const target = sim.addPlayer({
      name: 'Bob',
      position: tile(7, 7),
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
