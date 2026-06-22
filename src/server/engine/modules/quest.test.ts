// Exercises the real shipped quest module (modules/quest) end to end,
// including a consumer script whose reward callback (a sandbox function)
// fires across the module boundary.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runInSandbox } from '../scripting/sandbox.js';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { useApi, clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import type { PlayerServer } from '../../../shared/types.js';

interface QuestState {
  progress: number;
  target: number;
  status: 'active' | 'completed';
}
interface QuestApi {
  define: (def: {
    id: string;
    name: string;
    target?: number;
    reward?: (p: PlayerServer) => void;
  }) => void;
  start: (p: PlayerServer, id: string) => boolean;
  advance: (p: PlayerServer, id: string, amount?: number) => void;
  get: (p: PlayerServer, id: string) => QuestState | undefined;
}

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  loadModules(); // real modules/ (quest enabled in game.json)
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

describe('quest module', () => {
  it('provides a quest API', () => {
    const quest = useApi<QuestApi>('quest');
    expect(quest?.define).toBeTypeOf('function');
    expect(quest?.start).toBeTypeOf('function');
  });

  it('tracks progress, persists to the data bag, and pushes quest:update', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const quest = useApi<QuestApi>('quest')!;

    quest.define({ id: 'hunt', name: 'Hunt', target: 3 });
    quest.start(alice, 'hunt');
    quest.advance(alice, 'hunt', 1);

    expect(quest.get(alice, 'hunt')).toMatchObject({ progress: 1, status: 'active' });
    // Persisted in the data bag (so it survives a reload/restart)
    expect((alice.data as { quests: Record<string, QuestState> }).quests.hunt!.progress).toBe(1);
    // A quest:update was pushed to the client tracker
    expect(
      drainGameEvents().some((e) => e.type === 'customPlayer' && e.channel === 'quest:update'),
    ).toBe(true);
  });

  it('a consumer script: accept + kills complete it and fire the reward', () => {
    const sim = createFixture(0);
    const giver = sim.addNpc({ name: 'Elder', behavior: 'shopkeeper', position: tile(6, 5) });
    const goblin = sim.addNpc({ name: 'Goblin', behavior: 'aggressive', position: tile(9, 9) });
    const alice = sim.addPlayer({ name: 'Alice', experience: 0, experienceToNextLevel: 10000 });

    const handle = runInSandbox(
      `
      const quest = use('quest');
      quest.define({
        id: 'hunt', name: 'Hunt', target: 2,
        reward: (p) => giveExperience(p, 500),
      });
      on('npcInteract', ({ player, npc }) => {
        if (npc.name === 'Elder') quest.start(player, 'hunt');
      });
      on('npcDeath', ({ npc, killer }) => {
        if (npc.name === 'Goblin') quest.advance(killer, 'hunt', 1);
      });
    `,
      'quest-consumer.js',
    );

    emit('npcInteract', { player: alice, npc: giver });
    emit('npcDeath', { npc: goblin, killer: alice });
    emit('npcDeath', { npc: goblin, killer: alice });

    const quest = useApi<QuestApi>('quest')!;
    expect(quest.get(alice, 'hunt')).toMatchObject({ progress: 2, status: 'completed' });
    expect(alice.experience).toBe(500); // reward (a sandbox fn) fired across the boundary

    handle.cleanup();
  });
});
