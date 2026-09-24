import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadClientModule,
  recordingContext,
  type LoadedClientModule,
} from '../../../test/clientModule';

// The hotbar half of the shipped modules/magic/client.js. The panel already
// greyed out a spell on cooldown; what this draws is the same state on the
// canvas, where a player who never opens the panel can see it.

const NOW = 1_700_000_000_000;
const SLOT = 128;
const HEIGHT = 72;

const spell = (over: Record<string, unknown> = {}) => ({
  id: 'arcane',
  name: 'Arcane',
  cost: 10,
  readyAt: 0,
  cooldownMs: 3000,
  ...over,
});

let mod: LoadedClientModule;

function push(state: unknown) {
  mod.handlers.get('magic:update')!(state);
}

function drawHotbar(canvas: [number, number] = [800, 600]) {
  const rec = recordingContext(canvas[0], canvas[1]);
  const hotbar = mod.overlays[0];
  hotbar.fn(rec.ctx, { x: 0, y: 0 });
  return rec;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mod = loadClientModule('magic');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('spell hotbar', () => {
  it('draws on the hud layer, so a night tint cannot dim it', () => {
    expect(mod.overlays).toHaveLength(1);
    expect(mod.overlays[0].order).toBe(100);
  });

  it('draws nothing before the first magic update', () => {
    expect(drawHotbar().calls).toHaveLength(0);
  });

  it('draws nothing for a player with no spells', () => {
    push({ mana: 100, manaMax: 100, spells: [] });

    expect(drawHotbar().calls).toHaveLength(0);
  });

  it('draws one slot per spell, centred along the bottom', () => {
    push({
      mana: 100,
      manaMax: 100,
      spells: [spell(), spell({ id: 'heal', name: 'Heal' })],
    });

    const rec = drawHotbar([800, 600]);
    const slots = rec.of('fillRect');

    // Two slot backgrounds, no shutters: both are ready.
    expect(slots).toHaveLength(2);
    const [x, y] = slots[0].args as number[];
    const width = 2 * SLOT + 6;
    expect(x).toBe((800 - width) / 2);
    expect(y).toBe(600 - HEIGHT - 12);
  });

  // The reason cooldownMs was added to the payload: without the whole
  // duration the client can only say "not yet", which is the grey button the
  // panel already had.
  it('shutters the slot in proportion to the cooldown left', () => {
    push({
      mana: 100,
      manaMax: 100,
      spells: [spell({ readyAt: NOW + 2250, cooldownMs: 3000 })],
    });

    const rec = drawHotbar();
    const shutter = rec.of('fillRect')[1].args as number[];

    expect(shutter[3]).toBeCloseTo(HEIGHT * 0.75);
  });

  it('counts down in whole seconds, and in tenths under one', () => {
    push({ mana: 100, manaMax: 100, spells: [spell({ readyAt: NOW + 2100 })] });
    const seconds = drawHotbar()
      .of('fillText')
      .map((c) => c.args[0]);
    expect(seconds).toContain('3');

    mod = loadClientModule('magic');
    push({ mana: 100, manaMax: 100, spells: [spell({ readyAt: NOW + 400 })] });
    const tenths = drawHotbar()
      .of('fillText')
      .map((c) => c.args[0]);
    expect(tenths).toContain('0.4');
  });

  it('shows the key and the cost so the slot is readable at a glance', () => {
    push({ mana: 100, manaMax: 100, spells: [spell({ cost: 30 })] });

    const text = drawHotbar()
      .of('fillText')
      .map((c) => c.args[0]);

    expect(text).toEqual(['F1', 'Arcane', '30 MP']);
  });

  it('does not shutter a spell the player merely cannot afford', () => {
    push({ mana: 5, manaMax: 100, spells: [spell({ cost: 50 })] });

    const rec = drawHotbar();

    // One rect: the slot itself. Too poor is dimmed, not counted down.
    expect(rec.of('fillRect')).toHaveLength(1);
    expect(rec.of('strokeRect')).toHaveLength(1);
  });

  it('stops at eight slots, however many spells the game defines', () => {
    push({
      mana: 100,
      manaMax: 100,
      spells: Array.from({ length: 12 }, (_, i) =>
        spell({ id: `s${i}`, name: `S${i}` }),
      ),
    });

    const slots = drawHotbar().of('fillRect');
    expect(slots).toHaveLength(8);
    for (const slot of slots) {
      const [x, , width] = slot.args as number[];
      expect(x).toBeGreaterThanOrEqual(12);
      expect(x + width).toBeLessThanOrEqual(788);
    }
  });
});

// Colour alone would not do it: the slot also carries a cross, so a heal and a
// damage spell are still distinguishable when the two greens read the same.
describe('friendly spells', () => {
  it('marks a friendly slot with a cross and a green border', () => {
    push({
      mana: 100,
      manaMax: 100,
      spells: [spell({ id: 'heal', name: 'Heal', friendly: true })],
    });

    const rec = drawHotbar();

    expect(rec.of('fillText').map((c) => c.args[0])).toContain('+');
    expect(rec.ctx.strokeStyle).toBe('rgba(74,222,128,0.9)');
  });

  it('leaves an offensive slot unmarked', () => {
    push({ mana: 100, manaMax: 100, spells: [spell()] });

    const rec = drawHotbar();

    expect(rec.of('fillText').map((c) => c.args[0])).not.toContain('+');
    expect(rec.ctx.strokeStyle).toBe('rgba(56,189,248,0.9)');
  });
});
