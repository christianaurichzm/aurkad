import { describe, it, expect, beforeEach } from 'vitest';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/party/client.js, loaded the way the browser loads it.

const rowan = { name: 'Rowan', health: 60, maxHealth: 120, level: 2 };
const kai = { name: 'Kai', health: 200, maxHealth: 200, level: 1 };

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  mod = loadClientModule('party', {
    getPlayer: () => rowan,
    getGameState: () => ({ players: { 'kai-id': kai } }),
  });
});

const panel = () => mod.panels[0];
const update = (payload: unknown) => mod.handlers.get('party:update')!(payload);
const bars = () => [...panel().body.querySelectorAll('[role="meter"]')];

describe('the party panel', () => {
  it("shows each member's health and level, the leader first and marked", () => {
    update({ leader: 'Rowan', members: ['Kai', 'Rowan'], maxMembers: 5 });

    expect(bars().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Rowan',
      'Kai',
    ]);
    expect(bars().map((b) => b.textContent)).toEqual(['60 / 120', '200 / 200']);
    expect(panel().body.textContent).toContain('Level 2');
    expect(panel().body.textContent).toContain('Leader');
    expect(panel().title).toBe('Party (2/5)');
  });

  // The party only sends names; health comes from the world in view.
  it('leaves a member out of view without a health it does not know', () => {
    update({ leader: 'Rowan', members: ['Rowan', 'Ayla'], maxMembers: 5 });

    expect(bars()[1]?.textContent).toBe('Out of sight');
  });

  it('opens itself when someone joins', () => {
    update({ leader: 'Rowan', members: ['Rowan'], maxMembers: 5 });
    expect(panel().open).toBe(false);

    update({ leader: 'Rowan', members: ['Rowan', 'Kai'], maxMembers: 5 });

    expect(panel().open).toBe(true);
  });
});
