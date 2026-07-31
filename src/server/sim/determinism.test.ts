import { describe, it, expect } from 'vitest';
import {
  CharacterAction,
  Direction,
  Key,
  MapStateServer,
  PlayerServer,
  Position,
  Tile,
} from '../../shared/types.js';
import { resetClock, advanceTick } from './clock.js';
import { seedRng } from './rng.js';
import { players, playersByName, runtimeState } from './state.js';
import { registerPlayer, getPlayerByName } from './world.js';
import {
  pressedKeysMap,
  handleKeyAction,
  processMovementIntent,
  processMovementCompletion,
} from '../services/world/movementService.js';

function makeTiles(rows: number, cols: number): Tile[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ tileIndex: 0, blocked: false })),
  );
}

function makeMap(): MapStateServer {
  return {
    id: '1',
    name: 'M',
    type: 'normal',
    tiles: makeTiles(20, 20),
    droppedItems: [],
    npcs: {},
    players: {},
  };
}

function makePlayer(): PlayerServer {
  return {
    id: 'a',
    name: 'Alice',
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
    position: { x: 64, y: 64 },
    direction: Direction.Down,
    action: CharacterAction.Idle,
    health: 100,
    kind: 'player',
  };
}

function press(key: Key, type: 'press' | 'release') {
  handleKeyAction({
    username: 'Alice',
    type: 'keyboard',
    keyboardAction: { key, type },
  });
}

function step(ticks: number) {
  for (let i = 0; i < ticks; i++) {
    advanceTick();
    processMovementCompletion();
    processMovementIntent();
  }
}

function reset() {
  resetClock();
  for (const k of Object.keys(runtimeState.maps)) delete runtimeState.maps[k];
  for (const k of Object.keys(players)) delete players[k];
  playersByName.clear();
  pressedKeysMap.clear();
}

function runScript(): Position {
  reset();
  seedRng(123);

  const map = makeMap();
  runtimeState.maps['1'] = map;
  const player = makePlayer();
  registerPlayer(player);
  map.players[player.id] = player;

  press(Key.ArrowRight, 'press');
  step(18);
  press(Key.ArrowRight, 'release');
  press(Key.ArrowDown, 'press');
  step(18);
  press(Key.ArrowDown, 'release');
  step(6);

  return { ...getPlayerByName('Alice')!.position };
}

describe('deterministic replay', () => {
  it('reaches the same state for the same inputs and seed', () => {
    const a = runScript();
    const b = runScript();
    expect(a).toEqual(b);
  });

  it('actually moved the player', () => {
    const end = runScript();
    expect(end).not.toEqual({ x: 64, y: 64 });
  });
});
