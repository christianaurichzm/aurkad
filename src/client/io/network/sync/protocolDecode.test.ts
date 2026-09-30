/**
 * The client half of the frozen wire format. The server test checks it still
 * emits these exact strings; this one checks the client turns them back into
 * the right world. A round trip built from shared helpers would pass while
 * the bytes drift, so everything here starts from raw strings.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PROTOCOL_GOLDEN_STEPS,
  type ProtocolGoldenStep,
} from '../../../../shared/testFixtures/wsProtocolGoldens';
import { getGameState, getPlayer } from '../../../core/gameState';
import {
  enqueueGameStateMessage,
  updateWebSocket,
  resetInterpolation,
} from './gameStateSync';
import { clearMovementQueues } from '../../../graphics/movementAnimation';
import { TILE_SIZE } from '../../../../shared/constants';

const spawnFloatingText = vi.hoisted(() => vi.fn());
vi.mock('../../../graphics/floatingText', async (original) => ({
  ...(await original<object>()),
  spawnFloatingText,
}));

vi.mock('../../../audio', () => ({
  playMusic: vi.fn(),
  stopMusic: vi.fn(),
  playSound: vi.fn(),
  setAudioListener: vi.fn(),
}));

/** Feeds one step's frames through the real decode path, like the socket. */
function applyStep(step: ProtocolGoldenStep): void {
  for (const raw of step.messages) {
    enqueueGameStateMessage(JSON.parse(raw));
  }
  updateWebSocket();
}

function stepNamed(label: string): ProtocolGoldenStep {
  const step = PROTOCOL_GOLDEN_STEPS.find((s) => s.label === label);
  if (!step) throw new Error(`no golden step "${label}"`);
  return step;
}

/** Replays from the first frame up to and including `label`. */
function replayThrough(label: string): void {
  for (const step of PROTOCOL_GOLDEN_STEPS) {
    applyStep(step);
    if (step.label === label) return;
  }
  throw new Error(`no golden step "${label}"`);
}

beforeEach(() => {
  clearMovementQueues();
  resetInterpolation();
});

describe('decoding the golden session', () => {
  it('builds the map from mapMeta plus chunks', () => {
    applyStep(stepNamed('first tick'));

    const map = getGameState();
    expect(map).not.toBeNull();
    expect(map!.id).toBe('map1');
    expect(map!.name).toBe('Test');
    // 2x2 map: the single chunk has to land in the grid mapMeta allocated.
    expect(map!.tiles).toHaveLength(2);
    expect(map!.tiles[0]).toHaveLength(2);
    expect(map!.tiles[0][0]).toEqual({ tileIndex: 0 });
  });

  it('inserts entities arriving in full, routed by kind', () => {
    replayThrough('first tick');

    const map = getGameState()!;
    expect(Object.keys(map.players)).toEqual(['bob']);
    expect(Object.keys(map.npcs)).toEqual(['npc1']);
    expect(map.players['bob'].position).toEqual({ x: 64, y: 0 });
    expect(map.npcs['npc1'].name).toBe('Goblin');
    expect(map.npcs['npc1'].health).toBe(30);
  });

  it('composes the local player from playerStats and self', () => {
    replayThrough('first tick');

    const me = getPlayer()!;
    // name/level/inventory come from the cold frame, position/health from self.
    expect(me.name).toBe('Alice');
    expect(me.level).toBe(1);
    expect(me.inventory).toEqual([
      {
        item: { id: 1, name: 'Potion', sprite: 4, type: 'consumable' },
        quantity: 3,
      },
    ]);
    expect(me.position).toEqual({ x: 0, y: 0 });
    expect(me.health).toBe(100);
  });

  it('keeps the cold state when later frames carry only self', () => {
    replayThrough('viewer moves');

    const me = getPlayer()!;
    expect(me.position).toEqual({ x: 0, y: 64 });
    expect(me.action).toBe('Walk');
    // Never resent, so the client must still be holding it.
    expect(me.name).toBe('Alice');
    expect(me.inventory).toHaveLength(1);
  });

  it('survives a tick that carries no frames at all', () => {
    replayThrough('idle tick');

    const me = getPlayer()!;
    expect(me.position).toEqual({ x: 0, y: 64 });
    expect(Object.keys(getGameState()!.players)).toEqual(['bob']);
  });

  it('merges a partial entity frame into what it already knows', () => {
    replayThrough('bob gains a targetPosition');

    const bob = getGameState()!.players['bob'];
    expect(bob.targetPosition).toEqual({ x: 64, y: 64 });
    // The frame carried targetPosition alone; everything else must survive.
    expect(bob.name).toBe('Bob');
    expect(bob.position).toEqual({ x: 64, y: 0 });
    expect(bob.health).toBe(100);
  });

  it('deletes a field the server cleared with null', () => {
    replayThrough('bob clears its targetPosition');

    const bob = getGameState()!.players['bob'];
    // Not "null" and not a leftover value: the key has to be gone, or the
    // renderer keeps interpolating toward a destination that no longer exists.
    expect('targetPosition' in bob).toBe(false);
    expect(bob.position).toEqual({ x: 64, y: 64 });
  });

  it('draws a hit once, as a number over the entity, beside the health it took', () => {
    replayThrough('bob clears its targetPosition');
    spawnFloatingText.mockClear();

    applyStep(stepNamed('the goblin is hit'));

    expect(getGameState()!.npcs['npc1'].health).toBe(23);
    expect(spawnFloatingText).toHaveBeenCalledOnce();
    const [x, y, text] = spawnFloatingText.mock.calls[0];
    expect([x, y, text]).toEqual([64 + TILE_SIZE / 2, 60, '7']);
  });

  it('removes entities listed in leave, players and npcs alike', () => {
    replayThrough('bob and the npc leave');

    const map = getGameState()!;
    expect(map.players).toEqual({});
    expect(map.npcs).toEqual({});
    // The viewer itself is unaffected by other entities leaving.
    expect(getPlayer()!.name).toBe('Alice');
  });
});
