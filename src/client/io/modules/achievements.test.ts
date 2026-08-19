import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/achievements/client.js, as the browser loads it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  vi.useFakeTimers();
  mod = loadClientModule('achievements');
});

afterEach(() => {
  vi.useRealTimers();
});

const panel = () => mod.panels[0];
const update = (payload: unknown) =>
  mod.handlers.get('achievements:update')!(payload);
const earn = (payload: unknown) =>
  mod.handlers.get('achievements:earned')!(payload);

const STATE = {
  earned: ['first_blood'],
  all: [
    {
      id: 'slayer',
      name: 'Slayer',
      description: 'Defeat 50.',
      progress: 5,
      target: 50,
    },
    {
      id: 'first_blood',
      name: 'First Blood',
      description: 'Defeat one.',
      progress: 1,
      target: 1,
    },
  ],
};

describe('the panel', () => {
  it('asks the server for the list on load', () => {
    expect(
      (
        mod.engine.sendServerEvent as unknown as {
          mock: { calls: [string][] };
        }
      ).mock.calls,
    ).toContainEqual(['achievements:request']);
  });

  it('says nothing is defined rather than showing a blank panel', () => {
    expect(panel().body.textContent).toContain('Nothing defined yet.');
  });

  it('counts the earned ones in the title', () => {
    update(STATE);

    expect(panel().title).toBe('Achievements (1/2)');
  });

  it('puts the earned ones first: a trophy case before a to-do list', () => {
    update(STATE);

    const marks = [...panel().body.querySelectorAll('span')]
      .map((s) => s.textContent)
      .filter((text) => text === '★' || text === '☆');
    expect(marks).toEqual(['★', '☆']);
  });

  it('shows progress on a locked one and nothing on an earned one', () => {
    update(STATE);

    expect(panel().body.textContent).toContain('5/50');
    expect(panel().body.textContent).not.toContain('1/1');
  });
});

describe('the toast', () => {
  it('appears on the event and takes itself away', () => {
    earn({ id: 'slayer', name: 'Slayer' });

    expect(mod.container.textContent).toContain('Slayer');
    expect(mod.container.textContent).toContain('Achievement unlocked');

    vi.advanceTimersByTime(3200);
    expect(mod.container.children).toHaveLength(0);
  });

  it('does not appear for a payload with no name', () => {
    earn({});
    earn(null);

    expect(mod.container.children).toHaveLength(0);
  });
});
