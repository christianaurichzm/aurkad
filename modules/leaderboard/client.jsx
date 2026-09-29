// @ts-check
// Leaderboard module, client entry: a ranked table, with a tab per board
// when the game keeps more than the level board.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT(). Board names use
// the same table (the level board is `level`).
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

const ui = engine.ui;

let state = { board: 'level', boards: [], rows: [] };
let shown = false;

function draw() {
  engine.render(shown && <LeaderboardWindow state={state} />);
}

// Asks on open too, since standings move while the window is shut.
function toggle() {
  shown = !shown;
  draw();
  if (shown)
    engine.sendServerEvent('leaderboard:request', { board: state.board });
}

const myName = () => {
  const me = engine.getPlayer();
  return me ? me.name : null;
};

const line = { display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 };
const rankCol = { flex: '0 0 34px' };
const nameCol = { flex: 1 };
const scoreCol = {
  flex: '0 0 70px',
  textAlign: /** @type {const} */ ('right'),
};

function LeaderboardWindow({ state }) {
  const t = engine.useT();
  const me = myName();
  return (
    <ui.Window
      title={t('Leaderboard - {board}', { board: state.board })}
      onClose={toggle}
    >
      {/* Only worth a row of tabs when there is a choice to make. */}
      {state.boards.length > 1 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {state.boards.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={name === state.board}
              style={
                name === state.board
                  ? { outline: '2px solid var(--color-text)' }
                  : undefined
              }
              onClick={() =>
                engine.sendServerEvent('leaderboard:request', { board: name })
              }
            >
              {t(name)}
            </button>
          ))}
        </div>
      )}
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {state.rows.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              padding: '8px 0',
            }}
          >
            {t('Nobody has ranked yet.')}
          </div>
        ) : (
          <>
            <div
              style={{
                ...line,
                color: 'var(--color-text-muted)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span style={rankCol}>{t('Rank')}</span>
              <span style={nameCol}>{t('Player')}</span>
              <span style={scoreCol}>{t('Score')}</span>
            </div>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {state.rows.map((row) => {
                // The player's own row, the one they opened the window to find.
                const mine = row.name === me;
                return (
                  <li key={row.name} style={line}>
                    <span
                      style={{ ...rankCol, color: 'var(--color-text-muted)' }}
                    >
                      #{row.rank}
                    </span>
                    <span
                      style={{
                        ...nameCol,
                        color: mine
                          ? 'var(--color-success)'
                          : 'var(--color-text)',
                        fontWeight: mine ? 'bold' : undefined,
                      }}
                    >
                      {row.name}
                    </span>
                    <span
                      style={{ ...scoreCol, color: 'var(--color-text-muted)' }}
                    >
                      {/* The level board carries a level; anything a script
                          submits has a score. */}
                      {row.level === undefined
                        ? String(row.score)
                        : `${t('level')} ${row.level}`}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </ui.Window>
  );
}

ui.actionButton('Leaderboard', toggle, 'l');

engine.onServerEvent('leaderboard:update', (payload) => {
  if (!payload) return;
  state = payload;
  draw();
});

engine.sendServerEvent('leaderboard:request');
