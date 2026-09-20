// @ts-check
// Leaderboard module, client entry: a ranked table, with a tab per board
// when the game keeps more than the level board.

engine.i18n({
  pt: {
    Leaderboard: 'Placar',
    'Leaderboard - {board}': 'Placar - {board}',
    level: 'nível',
    'Nobody has ranked yet.': 'Ninguém no placar ainda.',
    Rank: 'Pos.',
    Player: 'Jogador',
    Score: 'Pontos',
  },
});

const TEXT = 'var(--color-text)';
const MUTED = 'var(--color-text-muted)';
const LINE = 'var(--color-border)';
const MINE = 'var(--color-success)';

const ui = engine.ui;
const panel = ui.panel({ title: 'Leaderboard' });

// Asking on open, not only on load: standings move while the panel is shut,
// and a board fetched when the page loaded is a board showing yesterday.
ui.actionButton(
  'Leaderboard',
  () => {
    panel.toggle();
    if (panel.isOpen())
      engine.sendServerEvent('leaderboard:request', { board: state.board });
  },
  'l',
);

let state = { board: 'level', boards: [], rows: [] };

const myName = () => {
  const me = engine.getPlayer();
  return me ? me.name : null;
};

function cell(text, opts) {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText =
    `font:${opts.bold ? 'bold ' : ''}12px sans-serif;color:${opts.color};` +
    `flex:${opts.flex};text-align:${opts.align || 'left'};`;
  return el;
}

function headerRow() {
  const line = document.createElement('div');
  line.style.cssText = `display:flex;gap:8px;padding:3px 0;border-bottom:1px solid ${LINE};`;
  line.append(
    cell(engine.t('Rank'), { color: MUTED, flex: '0 0 34px' }),
    cell(engine.t('Player'), { color: MUTED, flex: '1' }),
    cell(engine.t('Score'), { color: MUTED, flex: '0 0 70px', align: 'right' }),
  );
  return line;
}

function entryRow(row) {
  const mine = row.name === myName();
  const line = document.createElement('div');
  line.style.cssText = 'display:flex;gap:8px;padding:3px 0;';
  // The player's own row is the one they opened the panel to find.
  line.append(
    cell(`#${row.rank}`, { color: MUTED, flex: '0 0 34px' }),
    cell(row.name, { color: mine ? MINE : TEXT, flex: '1', bold: mine }),
    cell(
      // The level board carries a level; anything a script submits has a score.
      row.level === undefined
        ? String(row.score)
        : `${engine.t('level')} ${row.level}`,
      { color: MUTED, flex: '0 0 70px', align: 'right' },
    ),
  );
  return line;
}

function render() {
  const list = document.createElement('div');
  list.style.cssText = 'max-height:280px;overflow-y:auto;';

  if (state.rows.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = engine.t('Nobody has ranked yet.');
    empty.style.cssText = `font:12px sans-serif;color:${MUTED};padding:8px 0;`;
    list.append(empty);
  } else {
    list.append(headerRow());
    for (const row of state.rows) list.append(entryRow(row));
  }

  panel.setTitle(engine.t('Leaderboard - {board}', { board: state.board }));

  // Only worth a row of tabs when there is a choice to make.
  const parts = [];
  if (state.boards.length > 1) {
    parts.push(
      ui.row(
        ...state.boards.map((name) => {
          const b = ui.button(name, () =>
            engine.sendServerEvent('leaderboard:request', { board: name }),
          );
          if (name === state.board) b.style.outline = `2px solid ${TEXT}`;
          return b;
        }),
      ),
    );
  }
  parts.push(list);
  panel.setBody(...parts);
}

engine.onServerEvent('leaderboard:update', (payload) => {
  if (!payload) return;
  state = payload;
  render();
});

engine.sendServerEvent('leaderboard:request');
render();
