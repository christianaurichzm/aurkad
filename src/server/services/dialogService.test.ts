import { describe, it, expect, beforeEach } from 'vitest';
import { showDialog, handleDialogChoice, clearDialogs } from './dialogService.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { createFixture } from '../sim/simFixture.js';

beforeEach(() => {
  clearDialogs();
  drainGameEvents();
});

function lastDialog(): { id: number; text: string; choices: string[] } | undefined {
  const ev = drainGameEvents().find(
    (e) => e.type === 'customPlayer' && e.channel === 'dialog:show',
  );
  return ev && 'payload' in ev ? (ev.payload as { id: number; text: string; choices: string[] }) : undefined;
}

describe('showDialog', () => {
  it('sends a dialog:show event to the player with text and choices', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });

    showDialog(player, { text: 'Hello?', choices: ['Yes', 'No'] });

    const d = lastDialog();
    expect(d?.text).toBe('Hello?');
    expect(d?.choices).toEqual(['Yes', 'No']);
    expect(typeof d?.id).toBe('number');
  });
});

describe('handleDialogChoice', () => {
  it('routes a valid choice back to the callback', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    let picked = -1;

    showDialog(player, { text: 'Pick', choices: ['A', 'B', 'C'] }, (i) => (picked = i));
    const id = lastDialog()!.id;

    handleDialogChoice(player, { id, index: 2 });
    expect(picked).toBe(2);
  });

  it('ignores a choice with a mismatched dialog id', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    let called = false;

    showDialog(player, { text: 'x', choices: ['A'] }, () => (called = true));
    handleDialogChoice(player, { id: 999, index: 0 });
    expect(called).toBe(false);
  });

  it('ignores an out-of-range index', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    let called = false;

    showDialog(player, { text: 'x', choices: ['A', 'B'] }, () => (called = true));
    const id = lastDialog()!.id;
    handleDialogChoice(player, { id, index: 5 });
    expect(called).toBe(false);
  });

  it('ignores a non-integer index', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    let called = false;

    showDialog(player, { text: 'x', choices: ['A'] }, () => (called = true));
    const id = lastDialog()!.id;
    handleDialogChoice(player, { id, index: 1.5 });
    expect(called).toBe(false);
  });

  it('a choiceless dialog accepts index 0 (Continue)', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    let called = false;

    showDialog(player, { text: 'Just text' }, () => (called = true));
    const id = lastDialog()!.id;
    handleDialogChoice(player, { id, index: 0 });
    expect(called).toBe(true);
  });

  it('a second choice for the same dialog is ignored (already consumed)', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    let count = 0;

    showDialog(player, { text: 'x', choices: ['A'] }, () => count++);
    const id = lastDialog()!.id;
    handleDialogChoice(player, { id, index: 0 });
    handleDialogChoice(player, { id, index: 0 });
    expect(count).toBe(1);
  });
});
