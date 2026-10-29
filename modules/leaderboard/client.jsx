// @ts-check
// Leaderboard module, client entry: a ranked table, with a tab per board
// when the game keeps more than the level board.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT(). Board names use
// the same table (the level board is `level`).
engine.i18n({
  pt: {
    Leaderboard: 'Placar',
    Boards: 'Placares',
    level: 'nível',
    'Nobody has ranked yet.': 'Ninguém no placar ainda.',
    'Standings appear as players earn them.':
      'As posições aparecem conforme os jogadores as conquistam.',
    Rank: 'Pos.',
    Player: 'Jogador',
    Score: 'Pontos',
    Level: 'Nível',
    you: 'você',
    'Your rank': 'Sua posição',
    'You are not on this board yet.': 'Você ainda não está neste placar.',
  },
  es: {
    Leaderboard: 'Clasificación',
    Boards: 'Tablas',
    level: 'nivel',
    'Nobody has ranked yet.': 'Aún no hay nadie en la clasificación.',
    'Standings appear as players earn them.':
      'Las posiciones aparecen a medida que los jugadores las ganan.',
    Rank: 'Pos.',
    Player: 'Jugador',
    Score: 'Puntos',
    Level: 'Nivel',
    you: 'tú',
    'Your rank': 'Tu posición',
    'You are not on this board yet.': 'Aún no estás en esta tabla.',
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

// How many rows a window shows before it scrolls.
const IN_VIEW = 10;

const columns = {
  display: 'grid',
  gridTemplateColumns: '44px 1fr auto',
  alignItems: 'center',
  gap: 8,
};

function LeaderboardWindow({ state }) {
  const t = engine.useT();
  const me = engine.getPlayer()?.name;
  const mine = state.rows.find((row) => row.name === me);
  // The level board carries a level; anything a script submits has a score.
  const levels = state.rows.some((row) => row.level !== undefined);
  return (
    <ui.Window
      title={t('Leaderboard')}
      width="regular"
      anchor="right"
      onClose={toggle}
      footer={
        // The player's own row stays in reach below the visible rows.
        state.rows.length > 0 &&
        (!mine ? (
          <span className="window-label">
            {t('You are not on this board yet.')}
          </span>
        ) : (
          mine.rank > IN_VIEW && (
            <ol className="list" aria-label={t('Your rank')}>
              <Row row={mine} self />
            </ol>
          )
        ))
      }
    >
      {/* Only worth a row of tabs when there is a choice to make. */}
      {state.boards.length > 1 && (
        <div className="window-tabs" role="tablist" aria-label={t('Boards')}>
          {state.boards.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              style={{ textTransform: 'capitalize' }}
              aria-selected={name === state.board}
              onClick={() =>
                engine.sendServerEvent('leaderboard:request', { board: name })
              }
            >
              {t(name)}
            </button>
          ))}
        </div>
      )}
      {state.rows.length === 0 ? (
        <ui.EmptyState
          icon="ranking"
          title={t('Nobody has ranked yet.')}
          hint={t('Standings appear as players earn them.')}
        />
      ) : (
        <>
          <div
            className="window-label"
            style={{ ...columns, padding: '0 8px' }}
            aria-hidden="true"
          >
            <span>{t('Rank')}</span>
            <span>{t('Player')}</span>
            <span>{t(levels ? 'Level' : 'Score')}</span>
          </div>
          <ol className="list">
            {state.rows.map((row) => (
              <Row key={row.name} row={row} self={row.name === me} />
            ))}
          </ol>
        </>
      )}
    </ui.Window>
  );
}

function Row({ row, self }) {
  const t = engine.useT();
  return (
    <li className="list-row" style={columns} data-self={self || undefined}>
      <span className="stack-count">
        {row.rank <= 3 ? (
          <span className="medal" data-place={row.rank}>
            {row.rank}
          </span>
        ) : (
          row.rank
        )}
      </span>
      <b>
        {row.name}
        {self && <small className="window-label"> ({t('you')})</small>}
      </b>
      <span className="stack-count">
        {row.level === undefined ? row.score.toLocaleString() : row.level}
      </span>
    </li>
  );
}

ui.actionButton('Leaderboard', toggle, 'l', 'ranking', 110);

engine.onServerEvent('leaderboard:update', (payload) => {
  if (!payload) return;
  state = payload;
  draw();
});

engine.sendServerEvent('leaderboard:request');
