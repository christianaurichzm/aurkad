import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordingContext } from '../../test/clientModule';
import { renderSpeechBubble, setPlayerSpeech } from './speechBubble';

let now = 0;

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

describe('setPlayerSpeech', () => {
  it('truncates a long line so the bubble cannot grow without bound', () => {
    const rec = recordingContext();
    setPlayerSpeech('p1', 'x'.repeat(100));

    renderSpeechBubble(rec.ctx, 'p1', 0, 0);

    const text = rec.of('fillText')[0].args[0] as string;
    expect(text).toHaveLength(42);
    expect(text.endsWith('...')).toBe(true);
  });

  it('keeps a short line exactly as typed', () => {
    const rec = recordingContext();
    setPlayerSpeech('p2', 'hi');

    renderSpeechBubble(rec.ctx, 'p2', 0, 0);

    expect(rec.of('fillText')[0].args[0]).toBe('hi');
  });
});

describe('renderSpeechBubble', () => {
  it('draws nothing for a player who has not spoken', () => {
    const rec = recordingContext();

    renderSpeechBubble(rec.ctx, 'silent', 0, 0);

    expect(rec.calls).toEqual([]);
  });

  it('centres the bubble above the given point', () => {
    const rec = recordingContext();
    setPlayerSpeech('p3', 'hey');

    renderSpeechBubble(rec.ctx, 'p3', 200, 500);

    const [bx, by, bw] = rec.of('roundRect')[0].args as number[];
    expect(bx + bw / 2).toBe(200); // centred on cx
    expect(by).toBeLessThan(500); // and above the head
    expect(rec.of('fillText')[0].args[1]).toBe(200);
  });

  // The bubble stops growing at a cap and the text must stop with it, or a
  // long line runs out of the box.
  it('keeps a long line inside its bubble', () => {
    const rec = recordingContext();
    setPlayerSpeech('p5', 'Anyone up for the crypt? Bring potions!!');

    renderSpeechBubble(rec.ctx, 'p5', 0, 0);

    const [, , bw] = rec.of('roundRect')[0].args as number[];
    const maxWidth = rec.of('fillText')[0].args[3] as number;
    expect(maxWidth).toBeLessThan(bw);
  });

  it('fades over the last quarter and then expires', () => {
    const rec = recordingContext();
    setPlayerSpeech('p4', 'bye');

    renderSpeechBubble(rec.ctx, 'p4', 0, 0);
    expect(rec.ctx.globalAlpha).toBe(1);

    now += 3800; // 95% through
    renderSpeechBubble(rec.ctx, 'p4', 0, 0);
    expect(rec.ctx.globalAlpha).toBeGreaterThan(0);
    expect(rec.ctx.globalAlpha).toBeLessThan(1);

    now += 300; // past the 4s life
    const after = recordingContext();
    renderSpeechBubble(after.ctx, 'p4', 0, 0);
    expect(after.calls).toEqual([]);
  });
});
