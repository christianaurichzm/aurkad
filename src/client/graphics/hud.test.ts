import { describe, it, expect } from 'vitest';
import { recordingContext } from '../../test/clientModule';
import { RuntimeNpc } from '../../shared/types';
import {
  getHealthBarInfo,
  getPlayerHudText,
  renderHUD,
  renderNpcLabel,
} from './hud';
import { Access } from '../../shared/types';

const fontSize = (font: string) => Number(/(\d+)px/.exec(font)?.[1] ?? 0);

describe('getPlayerHudText', () => {
  it('renders level in parentheses without the level label', () => {
    expect(getPlayerHudText('Alice', 5)).toBe('Alice (5)');
  });

  it('is the name alone in a game without levels', () => {
    expect(getPlayerHudText('Alice', 5, false)).toBe('Alice');
  });
});

describe('getHealthBarInfo', () => {
  it('should return green color for 100% health', () => {
    const result = getHealthBarInfo(100, 100);

    expect(result.percentage).toBe(1);
    expect(result.color).toBe('green');
    expect(result.text).toBe('100%');
  });

  it('should return green color for 75% health', () => {
    const result = getHealthBarInfo(75, 100);

    expect(result.percentage).toBe(0.75);
    expect(result.color).toBe('green');
    expect(result.text).toBe('75%');
  });

  it('should return green color for 51% health', () => {
    const result = getHealthBarInfo(51, 100);

    expect(result.percentage).toBe(0.51);
    expect(result.color).toBe('green');
    expect(result.text).toBe('51%');
  });

  it('should return yellow color for 50% health', () => {
    const result = getHealthBarInfo(50, 100);

    expect(result.percentage).toBe(0.5);
    expect(result.color).toBe('yellow');
    expect(result.text).toBe('50%');
  });

  it('should return yellow color for 30% health', () => {
    const result = getHealthBarInfo(30, 100);

    expect(result.percentage).toBe(0.3);
    expect(result.color).toBe('yellow');
    expect(result.text).toBe('30%');
  });

  it('should return yellow color for 21% health', () => {
    const result = getHealthBarInfo(21, 100);

    expect(result.percentage).toBe(0.21);
    expect(result.color).toBe('yellow');
    expect(result.text).toBe('21%');
  });

  it('should return red color for 20% health', () => {
    const result = getHealthBarInfo(20, 100);

    expect(result.percentage).toBe(0.2);
    expect(result.color).toBe('red');
    expect(result.text).toBe('20%');
  });

  it('should return red color for 10% health', () => {
    const result = getHealthBarInfo(10, 100);

    expect(result.percentage).toBe(0.1);
    expect(result.color).toBe('red');
    expect(result.text).toBe('10%');
  });

  it('should return red color for 0% health', () => {
    const result = getHealthBarInfo(0, 100);

    expect(result.percentage).toBe(0);
    expect(result.color).toBe('red');
    expect(result.text).toBe('0%');
  });

  it('should handle different max health values', () => {
    const result = getHealthBarInfo(75, 150);

    expect(result.percentage).toBe(0.5);
    expect(result.color).toBe('yellow');
    expect(result.text).toBe('50%');
  });

  it('should handle overheal (current > max)', () => {
    const result = getHealthBarInfo(120, 100);

    expect(result.percentage).toBe(1);
    expect(result.color).toBe('green');
    expect(result.text).toBe('100%');
  });

  it('should handle negative health', () => {
    const result = getHealthBarInfo(-10, 100);

    expect(result.percentage).toBe(0);
    expect(result.color).toBe('red');
    expect(result.text).toBe('0%');
  });

  it('should round percentage correctly', () => {
    const result = getHealthBarInfo(33, 100);

    expect(result.percentage).toBe(0.33);
    expect(result.text).toBe('33%');
  });

  it('should handle decimal percentages', () => {
    const result = getHealthBarInfo(66.6, 100);

    expect(result.percentage).toBeCloseTo(0.666, 3);
    expect(result.text).toBe('67%');
  });
});

describe('renderNpcLabel', () => {
  const npc = (name: string) =>
    ({
      name,
      behavior: 'friendly',
      position: { x: 0, y: 64 },
    }) as unknown as RuntimeNpc;

  it('draws the name large enough and outlined to read over a tileset', () => {
    const rec = recordingContext();

    renderNpcLabel(npc('Lia'), false, rec.ctx);

    expect(rec.of('strokeText')[0]?.args[0]).toBe('Lia');
    expect(rec.of('fillText')[0]?.args[0]).toBe('Lia');
    expect(fontSize(rec.ctx.font)).toBeGreaterThanOrEqual(13);
  });

  // The health bar border is stroked on the same context right after the label,
  // so a widened outline that is not put back thickens every bar on screen.
  it('leaves lineWidth back at 1 for the health bar drawn next', () => {
    const rec = recordingContext();

    renderNpcLabel(npc('Ivo'), true, rec.ctx);

    expect(rec.ctx.lineWidth).toBe(1);
  });

  // Mitred, the outline of a small bold M or W sticks out above the name.
  it('outlines with round joins, and puts the mitred ones back', () => {
    const rec = recordingContext();
    let join: CanvasLineJoin | undefined;
    const stroke = rec.ctx.strokeText.bind(rec.ctx);
    rec.ctx.strokeText = (...args) => {
      join = rec.ctx.lineJoin;
      stroke(...args);
    };

    renderNpcLabel(npc('Mira, huntress'), false, rec.ctx);

    expect(join).toBe('round');
    expect(rec.ctx.lineJoin).toBe('miter');
  });

  it('sets a title after the comma as a smaller line under the name', () => {
    const rec = recordingContext();
    const fonts: string[] = [];
    const fill = rec.ctx.fillText.bind(rec.ctx);
    rec.ctx.fillText = (...args) => {
      fonts.push(rec.ctx.font);
      fill(...args);
    };

    renderNpcLabel(npc('Thomas, merchant'), false, rec.ctx);

    const lines = rec.of('fillText').map((c) => c.args);
    expect(lines.map(([text]) => text)).toEqual(['merchant', 'Thomas']);
    expect(lines[0][2]).toBeGreaterThan(lines[1][2] as number);
    expect(fontSize(fonts[0])).toBeLessThan(fontSize(fonts[1]));
  });

  it('draws nothing for an unnamed npc', () => {
    const rec = recordingContext();

    renderNpcLabel(npc(''), false, rec.ctx);

    expect(rec.calls).toEqual([]);
  });
});

// A dark name gets a light halo, which must be off again before the next
// sprite is drawn.
describe('renderHUD', () => {
  const player = (access: Access, extra = {}) =>
    ({
      name: 'Nyx',
      level: 3,
      access,
      position: { x: 0, y: 64 },
      ...extra,
    }) as never;

  it('haloes a dark name instead of outlining it', () => {
    const rec = recordingContext();

    renderHUD(player(Access.ADMIN), rec.ctx);

    expect(rec.of('strokeText')).toHaveLength(0);
    expect(rec.of('fillText').length).toBeGreaterThan(1);
    expect(rec.ctx.shadowBlur).toBe(0);
  });

  // A tag in a dark colour over an admin's name reads as one label with it:
  // both haloed, neither outlined.
  it('draws a tag in the colour set for it', () => {
    const rec = recordingContext();
    const tagFill: unknown[] = [];
    const fill = rec.ctx.fillText.bind(rec.ctx);
    rec.ctx.fillText = (...args) => {
      if (args[0] === 'Rootbreaker') tagFill.push(rec.ctx.fillStyle);
      fill(...args);
    };

    renderHUD(
      player(Access.ADMIN, {
        nameTag: 'Rootbreaker',
        nameTagColor: '#6d28d9',
      }),
      rec.ctx,
    );

    expect(tagFill[0]).toBe('#6d28d9');
    expect(rec.of('strokeText')).toHaveLength(0);
  });

  it('keeps the outline for a name that reads over black', () => {
    const rec = recordingContext();

    renderHUD(player(Access.USER), rec.ctx);

    expect(rec.of('strokeText')[0]?.args[0]).toBe('Nyx (3)');
    expect(rec.ctx.lineWidth).toBe(1);
  });
});
