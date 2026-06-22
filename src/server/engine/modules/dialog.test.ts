// Exercises the real shipped dialog module (modules/dialog) end to end: a
// consumer uses use('dialog').show, and the client's choice (simulated via a
// dialog:choose custom action) routes back to the caller's callback.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { useApi, clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/customEventService.js';
import { createFixture } from '../../sim/simFixture.js';
import type { PlayerServer } from '../../../shared/types.js';

interface DialogApi {
  show: (
    player: PlayerServer,
    options: { text: string; choices?: string[] },
    onChoice?: (i: number) => void,
  ) => void;
}

function dialogId(): number {
  const ev = drainGameEvents().find(
    (e) => e.type === 'customPlayer' && e.channel === 'dialog:show',
  ) as { payload: { id: number } } | undefined;
  if (!ev) throw new Error('no dialog:show event');
  return ev.payload.id;
}

function choose(player: PlayerServer, id: number, index: number) {
  handleCustomAction({
    type: 'custom',
    username: player.name,
    channel: 'dialog:choose',
    payload: { id, index },
  });
}

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  loadModules(); // real modules/ (dialog enabled in game.json)
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

describe('dialog module', () => {
  it('provides a dialog API', () => {
    expect(useApi<DialogApi>('dialog')?.show).toBeTypeOf('function');
  });

  it('show emits dialog:show and a valid choice runs the callback', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const dialog = useApi<DialogApi>('dialog')!;

    let picked = -1;
    dialog.show(
      alice,
      { text: 'Pick', choices: ['A', 'B'] },
      (i) => (picked = i),
    );

    choose(alice, dialogId(), 1);
    expect(picked).toBe(1);
  });

  it('ignores an out-of-range or mismatched choice', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const dialog = useApi<DialogApi>('dialog')!;

    let called = false;
    dialog.show(alice, { text: 'x', choices: ['A'] }, () => (called = true));
    const id = dialogId();

    choose(alice, id, 5); // out of range
    choose(alice, 9999, 0); // wrong id
    expect(called).toBe(false);

    choose(alice, id, 0); // valid
    expect(called).toBe(true);
  });
});
