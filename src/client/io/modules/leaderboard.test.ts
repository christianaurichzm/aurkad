import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/leaderboard/client.jsx, compiled and loaded the way
// the browser gets it.

let mod: ReturnType<typeof loadClientModule>;

const load = (playerName?: string) =>
  loadClientModule('leaderboard', {
    getPlayer: () => (playerName ? { name: playerName } : undefined),
  });

beforeEach(() => {
  document.body.innerHTML = '';
  mod = load('Ana');
});

const update = (payload: unknown) =>
  act(() => mod.handlers.get('leaderboard:update')!(payload));
const toggle = () => act(() => mod.actions.get('Leaderboard')!.click());
// The window's own content, so the title bar's close button is not counted.
const body = () => screen.getByRole('dialog').querySelector('.window-content')!;
const texts = () =>
  [...body().querySelectorAll('span')].map((s) => s.textContent);
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

  it('opens from the Actions menu and closes on Escape', () => {
    toggle();
    expect(
      screen.getByRole('dialog', { name: 'Leaderboard - level' }),
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says the board is empty rather than drawing a bare header', () => {
    toggle();

    expect(body().textContent).toContain('Nobody has ranked yet.');
    expect(texts()).not.toContain('Rank');
  });

  it('draws a header and one row per entry once there is something', () => {
    update(LEVEL_BOARD);
    toggle();

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
    toggle();

    expect(
      screen.getByRole('dialog', { name: 'Leaderboard - level' }),
    ).toBeTruthy();
  });

  it('picks out the row the player opened the window to find', () => {
    update(LEVEL_BOARD);
    toggle();

    expect(screen.getByText('Ana').style.fontWeight).toBe('bold');
    expect(screen.getByText('Bo').style.fontWeight).not.toBe('bold');
  });

  it('shows a plain score for a board with no levels in it', () => {
    update({
      board: 'richest',
      boards: ['level', 'richest'],
      rows: [{ rank: 1, name: 'Ana', score: 9000 }],
    });
    toggle();

    expect(texts()).toContain('9000');
  });
});

describe('opening the window', () => {
  it('asks again, because standings move while it is shut', () => {
    update({ ...LEVEL_BOARD, board: 'richest' });
    const before = sent().length;

    toggle();

    expect(sent()).toHaveLength(before + 1);
    expect(sent().at(-1)).toEqual([
      'leaderboard:request',
      { board: 'richest' },
    ]);
  });

  it('asks nothing on the click that closes it', () => {
    toggle(); // open
    const before = sent().length;

    toggle(); // close

    expect(sent()).toHaveLength(before);
  });
});

describe('choosing a board', () => {
  it('offers no tabs when there is only one', () => {
    update(LEVEL_BOARD);
    toggle();

    expect(body().querySelectorAll('button')).toHaveLength(0);
  });

  it('offers one per board and asks the server for the one clicked', () => {
    update({ ...LEVEL_BOARD, boards: ['level', 'richest'] });
    toggle();

    const tabs = [...body().querySelectorAll('button')];
    expect(tabs.map((b) => b.textContent)).toEqual(['level', 'richest']);
    fireEvent.click(tabs[1]);

    expect(sent()).toContainEqual([
      'leaderboard:request',
      { board: 'richest' },
    ]);
  });
});

describe('a payload that is not there', () => {
  it('is ignored rather than drawn from', () => {
    update(LEVEL_BOARD);
    toggle();
    expect(() => update(null)).not.toThrow();
    expect(texts()).toContain('Bo');
  });
});
