/**
 * The chest every new game starts with (game/scripts/chest.js in
 * templates/new-game), run as the server runs it: on a tile it is stepped
 * on, on an npc it is opened with the interact key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runInSandbox, type ScriptHandle } from './sandbox.js';
import { clearEntityBehaviors } from './entityScripts.js';
import { clearAll } from '../hooks.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { rebuildQuadtree } from '../../sim/spatialManager.js';
import { handleInteract } from '../../services/world/interactionService.js';
import { Direction, Key, type Item } from '../../../shared/types.js';

const GEM = 7;
const source = fs.readFileSync(
  path.join(process.cwd(), 'templates/new-game/game/scripts/chest.js'),
  'utf-8',
);

let sim: ReturnType<typeof createFixture>;
let handle: ScriptHandle;

beforeEach(() => {
  clearAll();
  clearEntityBehaviors();
  sim = createFixture(0);
  sim.addItem({ id: GEM, name: 'Gem', sprite: 0, type: 'consumable' } as Item);
  handle = runInSandbox(source, 'chest.js');
});

afterEach(() => handle.cleanup());

const gems = (player: {
  inventory: { items: { item: unknown; quantity: number }[] };
}) =>
  player.inventory.items
    .filter((i) => i.item === GEM || (i.item as Item)?.id === GEM)
    .reduce((n, i) => n + i.quantity, 0);

describe('an npc chest', () => {
  it('opens with the interact key, once, and shows itself open', () => {
    const chest = sim.addNpc({
      behavior: 'friendly',
      position: tile(5, 5),
      sprite: 394,
      scriptId: 'chest',
      scriptParams: { itemId: GEM, quantity: 2, once: true, openSprite: 395 },
    });
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 6),
      direction: Direction.Up,
    });
    rebuildQuadtree(sim.mapId, sim.map);

    handleInteract(player);
    handleInteract(player);

    expect(gems(player)).toBe(2);
    expect(chest.sprite).toBe(395);
  });
});

describe('tile chests', () => {
  // Keyed by the tile's graphic, two chests drawn the same way would share
  // one "looted" flag, and opening one would empty the other.
  it('are looted one by one even when they look the same', () => {
    const chest = {
      tileIndex: 1015,
      triggers: [
        {
          action: 'script' as const,
          scriptId: 'chest',
          scriptParams: { itemId: GEM, once: true },
        },
      ],
    };
    sim.map.tiles[2]![2] = structuredClone(chest);
    sim.map.tiles[2]![4] = structuredClone(chest);
    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    sim.press('Alice', Key.ArrowDown);
    sim.step();
    sim.release('Alice', Key.ArrowDown);
    player.position = tile(4, 1);
    rebuildQuadtree(sim.mapId, sim.map);
    sim.step(10);
    sim.press('Alice', Key.ArrowDown);
    sim.step();

    expect(gems(player)).toBe(2);
  });
});
