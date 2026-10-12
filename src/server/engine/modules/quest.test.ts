// Exercises the real shipped quest module (modules/quest) end to end,
// including a consumer script whose reward callback (a sandbox function)
// fires across the module boundary.
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  onTestFinished,
  vi,
} from 'vitest';
import { config } from '../../config.js';
import { runInSandbox } from '../scripting/sandbox.js';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { useApi, clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import type { Quest, PlayerServer } from '../../../shared/types.js';

// Authored quests live in the content cache the editor writes to; the model
// behind it is mocked so seeding one needs no database.
vi.mock('../../model/Quest.js', () => ({
  default: {
    findOneAndUpdate: () => Promise.resolve(undefined),
    deleteOne: () => Promise.resolve(undefined),
    find: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
  },
}));

const { createOrUpdateQuest, clearQuestCache } =
  await import('../../services/content/questService.js');

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
  clearQuestCache();
  drainGameEvents();
  loadModulesForTest('quest');
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

    expect(quest.get(alice, 'hunt')).toMatchObject({
      progress: 1,
      status: 'active',
    });
    // Persisted in the data bag (so it survives a reload/restart)
    expect(
      (alice.data as { quests: Record<string, QuestState> }).quests.hunt!
        .progress,
    ).toBe(1);
    // A quest:update was pushed to the client tracker
    expect(
      drainGameEvents().some(
        (e) => e.type === 'customPlayer' && e.channel === 'quest:update',
      ),
    ).toBe(true);
  });

  it('a consumer script: accept + kills complete it and fire the reward', () => {
    const sim = createFixture(0);
    const giver = sim.addNpc({
      name: 'Elder',
      behavior: 'shopkeeper',
      position: tile(6, 5),
    });
    const goblin = sim.addNpc({
      name: 'Goblin',
      behavior: 'aggressive',
      position: tile(9, 9),
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      experience: 0,
      experienceToNextLevel: 10000,
    });

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
    emit('npcDeath', { npc: goblin, killer: alice, contributors: [] });
    emit('npcDeath', { npc: goblin, killer: alice, contributors: [] });

    const quest = useApi<QuestApi>('quest')!;
    expect(quest.get(alice, 'hunt')).toMatchObject({
      progress: 2,
      status: 'completed',
    });
    expect(alice.experience).toBe(500); // reward (a sandbox fn) fired across the boundary

    handle.cleanup();
  });

  // Player data at its limit refuses the write. Paying before the refusal
  // would leave the quest open in the stored bag, paying on every kill.
  it('pays a quest once even while player data refuses to record it', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const quest = useApi<QuestApi>('quest')!;
    let paid = 0;
    quest.define({ id: 'hunt', name: 'Hunt', target: 1, reward: () => paid++ });
    quest.start(alice, 'hunt');

    const limits = config.scriptData as { maxValueBytes: number };
    const was = limits.maxValueBytes;
    limits.maxValueBytes = 10;
    onTestFinished(() => {
      limits.maxValueBytes = was;
    });

    quest.advance(alice, 'hunt', 1);
    quest.advance(alice, 'hunt', 1);
    expect(paid).toBe(0);
    expect(quest.get(alice, 'hunt')?.status).toBe('active');

    limits.maxValueBytes = was;
    quest.advance(alice, 'hunt', 1);
    quest.advance(alice, 'hunt', 1);
    expect(paid).toBe(1);
    expect(quest.get(alice, 'hunt')?.status).toBe('completed');
  });
});

/**
 * The authored side: a quest is a document and the module advances it from
 * the hook its objective names. Nothing here registers a progress handler,
 * which is what separates the editor path from the script one above.
 */
describe('quest module with authored quests', () => {
  const killOrcs: Quest = {
    id: 'orcs',
    name: 'Orcs at the gate',
    objective: { type: 'kill', npcId: 'orc', count: 2 },
    reward: { experience: 50 },
  };

  // Content in the cache and the module loaded, as a real boot leaves them.
  async function bootWith(...quests: Quest[]): Promise<QuestApi> {
    unloadAllModules();
    clearAll();
    clearProvides();
    for (const quest of quests) await createOrUpdateQuest(quest);
    loadModulesForTest('quest');
    return useApi<QuestApi>('quest')!;
  }

  it('registers a content quest so it can be started by id', async () => {
    const quest = await bootWith(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    expect(quest.start(alice, 'orcs')).toBe(true);
    expect(quest.get(alice, 'orcs')).toMatchObject({
      progress: 0,
      target: 2,
      status: 'active',
    });
  });

  // The trap: a map-spawned npc's id is "<template>:<row>:<col>", so matching
  // on id rather than templateId would never advance anything in a real world.
  it('counts kills by template id, not the runtime instance id', async () => {
    const quest = await bootWith(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    quest.start(alice, 'orcs');

    const orc = sim.addNpc({ id: 'orc:4:9', templateId: 'orc' });
    emit('npcDeath', { npc: orc, killer: alice, contributors: [] });

    expect(quest.get(alice, 'orcs')?.progress).toBe(1);
  });

  it('completes on the last kill and pays the declared reward', async () => {
    const quest = await bootWith(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      experience: 0,
      experienceToNextLevel: 10000,
    });
    quest.start(alice, 'orcs');

    const orc = sim.addNpc({ id: 'orc:1:1', templateId: 'orc' });
    emit('npcDeath', { npc: orc, killer: alice, contributors: [] });
    emit('npcDeath', { npc: orc, killer: alice, contributors: [] });

    expect(quest.get(alice, 'orcs')?.status).toBe('completed');
    expect(alice.experience).toBe(50);
  });

  it('tells the client what a quest pays, items by name and picture', async () => {
    const quest = await bootWith({
      ...killOrcs,
      reward: { experience: 50, items: [{ itemId: 3, quantity: 25 }] },
    });
    const sim = createFixture(0);
    sim.addItem({
      id: 3,
      name: 'Gold Coin',
      type: 'money',
      sprite: 7,
    } as Parameters<typeof sim.addItem>[0]);
    const alice = sim.addPlayer({ name: 'Alice' });
    drainGameEvents();
    quest.start(alice, 'orcs');

    const pushed = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'quest:update',
    ) as { payload: { id: string; reward: unknown }[] } | undefined;
    expect(pushed?.payload.find((q) => q.id === 'orcs')?.reward).toEqual({
      experience: 50,
      items: [{ name: 'Gold Coin', sprite: 7, quantity: 25 }],
    });
  });

  it('ignores a kill of an npc the objective does not name', async () => {
    const quest = await bootWith(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    quest.start(alice, 'orcs');

    const goblin = sim.addNpc({ id: 'goblin:2:2', templateId: 'goblin' });
    emit('npcDeath', { npc: goblin, killer: alice, contributors: [] });

    expect(quest.get(alice, 'orcs')?.progress).toBe(0);
  });

  it('does not advance a quest the player never started', async () => {
    const quest = await bootWith(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const orc = sim.addNpc({ id: 'orc:1:1', templateId: 'orc' });
    emit('npcDeath', { npc: orc, killer: alice, contributors: [] });

    expect(quest.get(alice, 'orcs')).toBeUndefined();
  });

  it('completes a talk objective on interact', async () => {
    const quest = await bootWith({
      id: 'visit',
      name: 'Visit the elder',
      objective: { type: 'talk', npcId: 'elder' },
    });
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    quest.start(alice, 'visit');

    const elder = sim.addNpc({ id: 'elder:3:3', templateId: 'elder' });
    emit('npcInteract', { player: alice, npc: elder });

    expect(quest.get(alice, 'visit')?.status).toBe('completed');
  });

  // Offering and completing in one keypress is the failure: the module advances
  // what is already open before it offers anything new.
  it('does not complete a talk quest on the interact that offered it', async () => {
    const quest = await bootWith({
      id: 'visit',
      name: 'Visit the elder',
      objective: { type: 'talk', npcId: 'elder' },
    });
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const elder = sim.addNpc({
      id: 'elder:3:3',
      templateId: 'elder',
      questId: 'visit',
    });
    emit('npcInteract', { player: alice, npc: elder });

    expect(quest.get(alice, 'visit')?.status).toBe('active');
  });

  it('starts the quest an npc offers through questId', async () => {
    const quest = await bootWith(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const giver = sim.addNpc({
      id: 'guard:1:1',
      name: 'Thomas',
      questId: 'orcs',
    });
    emit('npcInteract', { player: alice, npc: giver });

    expect(quest.get(alice, 'orcs')).toMatchObject({
      status: 'active',
      from: 'Thomas',
    });
  });

  it('completes a reach objective on the named tile only', async () => {
    const quest = await bootWith({
      id: 'scout',
      name: 'Scout the ridge',
      objective: { type: 'reach', mapId: '1', row: 4, col: 6 },
    });
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    quest.start(alice, 'scout');
    const map = { id: '1' } as never;
    const emptyTile = {} as never;

    alice.position = tile(5, 4);
    emit('tileEnter', { player: alice, tile: emptyTile, map });
    expect(quest.get(alice, 'scout')?.status).toBe('active');

    alice.position = tile(6, 4);
    emit('tileEnter', { player: alice, tile: emptyTile, map });
    expect(quest.get(alice, 'scout')?.status).toBe('completed');
  });

  // A script definition has to win, or the escape hatch is not one.
  it('lets a script override a content quest of the same id', async () => {
    const quest = await bootWith(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    quest.define({ id: 'orcs', name: 'Scripted', target: 99 });
    quest.start(alice, 'orcs');

    expect(quest.get(alice, 'orcs')?.target).toBe(99);
  });

  // The editor saves into the running game: a quest written after boot, or a
  // rule changed on one, counts from its next event, not from the next restart.
  it('starts and counts a quest saved after the module loaded', async () => {
    const quest = await bootWith();
    await createOrUpdateQuest(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    expect(quest.start(alice, 'orcs')).toBe(true);
    const orc = sim.addNpc({ id: 'orc:1:1', templateId: 'orc' });
    emit('npcDeath', { npc: orc, killer: alice, contributors: [] });

    expect(quest.get(alice, 'orcs')?.progress).toBe(1);
  });

  it('matches kills against the objective as it is now', async () => {
    const quest = await bootWith(killOrcs);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    quest.start(alice, 'orcs');

    await createOrUpdateQuest({
      ...killOrcs,
      objective: { type: 'kill', npcId: 'goblin', count: 2 },
    });
    const goblin = sim.addNpc({ id: 'goblin:1:1', templateId: 'goblin' });
    emit('npcDeath', { npc: goblin, killer: alice, contributors: [] });

    expect(quest.get(alice, 'orcs')?.progress).toBe(1);
  });
});
