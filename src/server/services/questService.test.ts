import { describe, it, expect, beforeEach } from 'vitest';
import {
  defineQuest,
  startQuest,
  advanceQuest,
  completeQuest,
  getQuest,
  getQuests,
  clearQuestDefs,
} from './questService.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { createFixture } from '../sim/simFixture.js';

beforeEach(() => {
  clearQuestDefs();
  drainGameEvents();
});

describe('startQuest', () => {
  it('creates active state and pushes a quest:update', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    defineQuest({ id: 'hunt', name: 'Hunt', description: 'Kill 5', target: 5 });

    expect(startQuest(p, 'hunt')).toBe(true);

    const q = getQuest(p, 'hunt');
    expect(q).toMatchObject({ name: 'Hunt', progress: 0, target: 5, status: 'active' });

    const ev = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'quest:update',
    );
    expect(ev).toBeDefined();
  });

  it('returns false for an unknown quest', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    expect(startQuest(p, 'nope')).toBe(false);
  });

  it('returns false if the player already has the quest', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    defineQuest({ id: 'hunt', name: 'Hunt' });
    startQuest(p, 'hunt');
    expect(startQuest(p, 'hunt')).toBe(false);
  });

  it('defaults the target to 1 when omitted', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    defineQuest({ id: 'talk', name: 'Talk' });
    startQuest(p, 'talk');
    expect(getQuest(p, 'talk')?.target).toBe(1);
  });
});

describe('advanceQuest', () => {
  it('increments progress without completing below the target', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    let rewarded = false;
    defineQuest({ id: 'hunt', name: 'Hunt', target: 5, reward: () => (rewarded = true) });
    startQuest(p, 'hunt');

    advanceQuest(p, 'hunt', 3);

    expect(getQuest(p, 'hunt')).toMatchObject({ progress: 3, status: 'active' });
    expect(rewarded).toBe(false);
  });

  it('completes and rewards once when reaching the target', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    let rewards = 0;
    defineQuest({ id: 'hunt', name: 'Hunt', target: 2, reward: () => rewards++ });
    startQuest(p, 'hunt');

    advanceQuest(p, 'hunt', 1);
    advanceQuest(p, 'hunt', 1); // hits target
    advanceQuest(p, 'hunt', 1); // already completed, no-op

    expect(getQuest(p, 'hunt')).toMatchObject({ progress: 2, status: 'completed' });
    expect(rewards).toBe(1);
  });

  it('clamps progress to the target', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    defineQuest({ id: 'hunt', name: 'Hunt', target: 3 });
    startQuest(p, 'hunt');
    advanceQuest(p, 'hunt', 99);
    expect(getQuest(p, 'hunt')?.progress).toBe(3);
  });

  it('does nothing for a quest the player has not started', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    defineQuest({ id: 'hunt', name: 'Hunt', target: 3 });
    advanceQuest(p, 'hunt', 1);
    expect(getQuest(p, 'hunt')).toBeUndefined();
  });
});

describe('completeQuest', () => {
  it('force-completes and grants the reward', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    let rewarded = false;
    defineQuest({ id: 'hunt', name: 'Hunt', target: 5, reward: () => (rewarded = true) });
    startQuest(p, 'hunt');

    completeQuest(p, 'hunt');

    expect(getQuest(p, 'hunt')).toMatchObject({ progress: 5, status: 'completed' });
    expect(rewarded).toBe(true);
  });
});

describe('persistence shape', () => {
  it('stores quest state in the player data bag', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    defineQuest({ id: 'hunt', name: 'Hunt', target: 2 });
    startQuest(p, 'hunt');

    expect((p.data as { quests: Record<string, unknown> }).quests.hunt).toBeDefined();
    expect(getQuests(p)).toHaveProperty('hunt');
  });
});
