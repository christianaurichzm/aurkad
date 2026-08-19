import { describe, it, expect, beforeEach } from 'vitest';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/leaderboard/client.js, as the browser loads it.

let mod: ReturnType<typeof loadClientModule>;

const load = (playerName?: string) =>
  loadClientModule('leaderboard', {
    getPlayer: () => (playerName ? { name: playerName } : undefined),
  });

beforeEach(() => {
  mod = load('Ana');
});

const panel = () => mod.panels[0];
const update = (payload: unknown) =>
  mod.handlers.get('leaderboard:update')!(payload);
const texts = () =>
  [...panel().body.querySelectorAll('span')].map((s) => s.textContent);
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;

const LEVEL_BOARD = {
  board: 'level',
  boards: ['level'],
  rows: [
    { rank: 1, name: 'Bo', score: 13_000_000, level: 13 },
    { rank: 2, name: 'Ana', score: 12_000_900, level: 12 },
  ],
};

describe('the table', () => {
  it('asks the server for the board on load', () => {
    expect(sent()).toContainEqual(['leaderboard:request']);
  });

  it('says the board is empty rather than drawing a bare header', () => {
    expect(panel().body.textContent).toContain('Nobody has ranked yet.');
    expect(texts()).not.toContain('Rank');
  });

  it('draws a header and one row per entry once there is something', () => {
    update(LEVEL_BOARD);

    expect(texts()).toEqual([
      'Rank',
      'Player',
      'Score',
      '#1',
      'Bo',
      'level 13',
      '#2',
      'Ana',
      'level 12',
    ]);
  });

  it('names the board in the title', () => {
    update(LEVEL_BOARD);

    expect(panel().title).toBe('Leaderboard - level');
  });

  it('picks out the row the player opened the panel to find', () => {
    update(LEVEL_BOARD);

    const rows = [...panel().body.querySelectorAll('span')];
    const mine = rows.find((s) => s.textContent === 'Ana')!;
    const other = rows.find((s) => s.textContent === 'Bo')!;
    expect(mine.style.fontWeight).toBe('bold');
    expect(other.style.fontWeight).not.toBe('bold');
  });

  it('shows a plain score for a board with no levels in it', () => {
    update({
      board: 'richest',
      boards: ['level', 'richest'],
      rows: [{ rank: 1, name: 'Ana', score: 9000 }],
    });

    expect(texts()).toContain('9000');
  });
});

describe('opening the panel', () => {
  it('asks again, because standings move while it is shut', () => {
    update({ ...LEVEL_BOARD, board: 'richest' });
    const before = sent().length;

    mod.actions.get('Leaderboard')!.click();

    expect(sent()).toHaveLength(before + 1);
    expect(sent().at(-1)).toEqual([
      'leaderboard:request',
      { board: 'richest' },
    ]);
  });

  it('asks nothing on the click that closes it', () => {
    mod.actions.get('Leaderboard')!.click(); // open
    const before = sent().length;

    mod.actions.get('Leaderboard')!.click(); // close

    expect(sent()).toHaveLength(before);
  });
});

describe('choosing a board', () => {
  it('offers no tabs when there is only one', () => {
    update(LEVEL_BOARD);

    expect(panel().body.querySelectorAll('button')).toHaveLength(0);
  });

  it('offers one per board and asks the server for the one clicked', () => {
    update({ ...LEVEL_BOARD, boards: ['level', 'richest'] });

    const tabs = [...panel().body.querySelectorAll('button')];
    expect(tabs.map((b) => b.textContent)).toEqual(['level', 'richest']);
    tabs[1].click();

    expect(sent()).toContainEqual([
      'leaderboard:request',
      { board: 'richest' },
    ]);
  });
});

describe('a payload that is not there', () => {
  it('is ignored rather than drawn from', () => {
    update(LEVEL_BOARD);
    expect(() => update(null)).not.toThrow();
    expect(texts()).toContain('Bo');
  });
});
