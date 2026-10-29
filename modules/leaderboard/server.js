// @ts-check
// Leaderboard: standings that outlive a session, kept as a sorted top-N in
// the shared store rather than a scan of every account.
//
// The level board is swept from online players on a timer and at logout,
// so an offline player's row is what it was when they left. Other boards
// are submitted by scripts.

i18n({
  pt: {
    'Top {count} by level:': 'Top {count} por nível:',
    'The board is empty.': 'O placar está vazio.',
    '#{rank} {name} - level {level}': '#{rank} {name} - nível {level}',
    'No such board.': 'Esse placar não existe.',
  },
  es: {
    'Top {count} by level:': 'Top {count} por nivel:',
    'The board is empty.': 'La tabla está vacía.',
    '#{rank} {name} - level {level}': '#{rank} {name} - nivel {level}',
    'No such board.': 'Esa tabla no existe.',
  },
});

const size = Math.max(1, Math.min(500, Number((config && config.size) || 100)));
const sweepTicks = msToTicks(
  Math.max(5, Number((config && config.sweepSeconds) || 60)) * 1000,
);

const SCOPE = 'leaderboard';
const LEVEL_BOARD = 'level';

/** @param {string} board */
function rows(board) {
  const stored = /** @type {any} */ (store.get(SCOPE, board));
  return Array.isArray(stored) ? stored : [];
}

/**
 * Merges entries into the board and trims it. Ties sort by name so the
 * board does not reshuffle every sweep; a list keeps a sweep to one write.
 */
function merge(board, entries) {
  const byName = new Map(rows(board).map((row) => [row.name, row]));
  for (const entry of entries) byName.set(entry.name, entry);
  const list = [...byName.values()].sort(
    board === LEVEL_BOARD ? byLevel : byScore,
  );
  return store.set(SCOPE, board, list.slice(0, size));
}

const byScore = (a, b) => b.score - a.score || a.name.localeCompare(b.name);

/**
 * Level first, experience as the tiebreak. One combined score would let a
 * full level 25 outrank an empty level 26.
 */
const byLevel = (a, b) =>
  b.level - a.level ||
  b.experience - a.experience ||
  a.name.localeCompare(b.name);

function submit(board, name, score, extra) {
  if (typeof name !== 'string' || !name || !Number.isFinite(score))
    return false;
  return merge(board, [{ name, score: Math.floor(score), ...(extra || {}) }]);
}

/** Boards with something in them, level first because the module owns it. */
function boardNames() {
  const names = store.keys(SCOPE).filter((name) => rows(name).length > 0);
  return [
    ...(names.includes(LEVEL_BOARD) ? [LEVEL_BOARD] : []),
    ...names.filter((name) => name !== LEVEL_BOARD).sort(),
  ];
}

const entryOf = (player) => ({
  name: player.name,
  score: player.level,
  level: player.level,
  experience: player.experience,
});

/** Everyone online, in one write. */
const sweep = () => merge(LEVEL_BOARD, getPlayers().map(entryOf));

function push(player, board) {
  const name = board || LEVEL_BOARD;
  sendEvent(player, 'leaderboard:update', {
    board: name,
    boards: boardNames(),
    rows: rows(name).map((row, index) => ({ rank: index + 1, ...row })),
  });
}

every(sweepTicks, sweep);

// Written at logout, so the row of a player who leaves stays current.
on('playerLeave', ({ player }) => merge(LEVEL_BOARD, [entryOf(player)]));

on('customAction', ({ player, channel, payload }) => {
  if (channel !== 'leaderboard:request') return;
  const data = /** @type {any} */ (payload);
  const board =
    data && typeof data.board === 'string' ? data.board : LEVEL_BOARD;
  // Swept first, since a player looks for their own row first.
  if (board === LEVEL_BOARD) sweep();
  push(player, board);
});

command(
  'top',
  { description: 'Standings: /top [board]' },
  ({ player, args, reply }) => {
    const board = String(args[0] || LEVEL_BOARD);
    const list = rows(board);
    if (list.length === 0)
      return reply(
        board === LEVEL_BOARD ? 'The board is empty.' : 'No such board.',
      );

    reply(
      t(player, 'Top {count} by level:', { count: Math.min(10, list.length) }),
    );
    list.slice(0, 10).forEach((row, index) => {
      reply(
        t(player, '#{rank} {name} - level {level}', {
          rank: index + 1,
          name: row.name,
          level: row.level === undefined ? row.score : row.level,
        }),
      );
    });
  },
);

provide('leaderboard', {
  /**
   * A score onto any board. The name is a string, so a script can rank
   * things that are not players.
   */
  submit: (board, name, score, extra) =>
    submit(String(board), name, score, extra),
  top: (board, count) =>
    rows(String(board || LEVEL_BOARD)).slice(0, count || size),
  rankOf: (board, name) =>
    rows(String(board || LEVEL_BOARD)).findIndex((row) => row.name === name) +
    1,
  boards: boardNames,
  /** Drops a board, which is how a season ends. */
  reset: (board) => store.delete(SCOPE, String(board || LEVEL_BOARD)),
});

log(`Leaderboard module ready (size=${size}, sweep=${sweepTicks} ticks).`);
