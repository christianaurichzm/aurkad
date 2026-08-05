// Exercises the real shipped dialog module (modules/dialog) end to end: a
// consumer uses use('dialog').show, and the client's choice (simulated via a
// dialog:choose custom action) routes back to the caller's callback.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { useApi, provideApi, clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { createFixture } from '../../sim/simFixture.js';
import type { Dialog, PlayerServer } from '../../../shared/types.js';

// The dialog documents live in the content cache the editor writes to; the
// model behind it is mocked so seeding one needs no database.
vi.mock('../../model/Dialog.js', () => ({
  default: {
    findOneAndUpdate: () => Promise.resolve(undefined),
    deleteOne: () => Promise.resolve(undefined),
    find: () => ({ lean: () => ({ exec: async () => [] }) }),
  },
}));

const { createOrUpdateDialog, clearDialogCache } = await import(
  '../../services/content/dialogService.js'
);

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

/** The last box the server told the client to draw. */
function lastShow(): { id: number; text: string; choices: string[] } {
  const shown = drainGameEvents().filter(
    (e) => e.type === 'customPlayer' && e.channel === 'dialog:show',
  ) as Array<{ payload: { id: number; text: string; choices: string[] } }>;
  const last = shown[shown.length - 1];
  if (!last) throw new Error('no dialog:show event');
  return last.payload;
}

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  clearDialogCache();
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

/**
 * The authored side: an npc carries a `dialogId` and the module walks the
 * document behind it. The conversation below is data, so a no-code editor
 * can produce it; the only code is what a choice names.
 */
describe('dialog module walking an authored conversation', () => {
  const conversation: Dialog = {
    id: 'elder',
    name: 'Elder',
    nodes: [
      {
        id: 'greet',
        text: 'You again.',
        choices: [
          { label: 'Tell me more', next: 'more' },
          { label: 'The secret', next: 'secret', condition: 'trusted' },
          { label: 'Take this', next: 'more', action: 'reward' },
          { label: 'Bye' },
        ],
      },
      { id: 'more', text: 'It is a long story.' },
      { id: 'secret', text: 'The key is under the rock.' },
    ],
  };

  async function talk(npcOverrides: { dialogId?: string } = {}) {
    await createOrUpdateDialog(conversation);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const npc = sim.addNpc({ dialogId: 'elder', ...npcOverrides });
    emit('npcInteract', { player: alice, npc });
    return { alice };
  }

  it('opens the first node when a player talks to the npc', async () => {
    const { alice } = await talk();
    void alice;

    const shown = lastShow();
    expect(shown.text).toBe('You again.');
  });

  it('follows the choice to the node it names', async () => {
    const { alice } = await talk();
    const greet = lastShow();

    choose(alice, greet.id, 0);

    expect(lastShow().text).toBe('It is a long story.');
  });

  it('says nothing for an npc without a dialog', async () => {
    await talk({ dialogId: undefined });
    expect(() => lastShow()).toThrow();
  });

  // Filtered before the box is built, so the index the client sends back
  // matches what it was shown; offering a choice and then refusing it would
  // lie to the player and shift every index after it.
  it('leaves out a choice whose condition says no', async () => {
    await talk();
    expect(lastShow().choices).toEqual(['Tell me more', 'Take this', 'Bye']);
  });

  it('offers the choice once its condition is registered', async () => {
    provideApi('dialogCondition.trusted', () => true);
    const { alice } = await talk();
    const greet = lastShow();

    expect(greet.choices).toContain('The secret');
    choose(alice, greet.id, 1);

    expect(lastShow().text).toBe('The key is under the rock.');
  });

  it('runs the action a choice names, with the player who picked it', async () => {
    const seen: string[] = [];
    provideApi('dialogAction.reward', (ctx: { player: PlayerServer }) =>
      seen.push(ctx.player.name),
    );
    const { alice } = await talk();
    const greet = lastShow();

    // Index 1 with the secret filtered out, as the client picks from the list
    // it was shown.
    choose(alice, greet.id, 1);

    expect(seen).toEqual(['Alice']);
    expect(lastShow().text).toBe('It is a long story.');
  });

  // Fails closed: the next node is written assuming the action ran, so showing
  // it would tell the player they got something they never received.
  it('stops instead of advancing when the action throws', async () => {
    provideApi('dialogAction.reward', () => {
      throw new Error('boom');
    });
    const { alice } = await talk();
    const greet = lastShow();

    choose(alice, greet.id, 1);

    expect(() => lastShow()).toThrow();
  });

  // Same when nothing registered it at all: an unregistered action is a script
  // that failed to load, not permission to hand out the reward anyway.
  it('stops on a choice whose action nobody registered', async () => {
    const { alice } = await talk();
    const greet = lastShow();

    choose(alice, greet.id, 1);

    expect(() => lastShow()).toThrow();
  });

  it('ends the conversation on a choice that leads nowhere', async () => {
    const { alice } = await talk();
    const greet = lastShow();

    choose(alice, greet.id, 2); // "Bye"

    expect(() => lastShow()).toThrow();
  });
});
