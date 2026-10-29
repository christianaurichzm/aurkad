// @ts-check
// PK module. Killing a player on a 'normal' PvP map flags the killer with
// a red name, set through the cosmetic resolver at high priority.
//
// Anyone may attack a PK on any map, and a PK may answer only another PK,
// or anyone on a PvP map.

const flagMs = Number((config && config.flagMinutes) || 10) * 60 * 1000;
const PK_SOURCE = 'pk';
const PK_PRIORITY = 100;

// The time left on the flag, counted down in ticks while the player is
// online, so logging out does not wait it off and replays match.
const LEFT = 'pkLeftMs';
const SWEEP_TICKS = 100;
const sweepMs = SWEEP_TICKS * (1000 / TICK_RATE);

const isPk = (p) => (Number(getPlayerData(p, LEFT)) || 0) > 0;

function flag(killer) {
  setPlayerData(killer, LEFT, flagMs);
  setPlayerData(
    killer,
    'pkCount',
    Number(getPlayerData(killer, 'pkCount') || 0) + 1,
  );
  setCosmetic(killer, 'nameColor', PK_SOURCE, 'red', PK_PRIORITY);
}

function unflag(p) {
  clearCosmetic(p, 'nameColor', PK_SOURCE);
  setPlayerData(p, LEFT, undefined);
}

i18n({
  pt: {
    'In-game only.': 'Só dentro do jogo.',
    'You are flagged as a PK ({kills} kills).':
      'Você está marcado como PK ({kills} mortes).',
    'Not flagged. Kills: {kills}.': 'Sem marca. Mortes: {kills}.',
  },
  es: {
    'In-game only.': 'Solo dentro del juego.',
    'You are flagged as a PK ({kills} kills).':
      'Estás marcado como PK ({kills} muertes).',
    'Not flagged. Kills: {kills}.': 'Sin marca. Muertes: {kills}.',
  },
});

on('playerDeath', ({ player, killer }) => {
  if (!killer || killer.kind !== 'player' || killer.name === player.name)
    return;
  // An admin is the server's own hand, so a GM is never flagged.
  if (killer.access >= Access.ADMIN) return;
  if (getMapPvp(player.mapId) !== 'normal') return; // only penalty maps flag
  // Hunting a player killer is open to anyone: that is what the flag is for.
  if (isPk(player)) return;
  flag(killer);
  broadcastMessage(killer.name + ' became a player killer!');
});

// A flagged target is open to everyone; off PvP maps that is the only way
// one player may hit another.
on('pvpAllowed', (ask) => {
  if (isPk(ask.target)) ask.allowed = true;
});

// Re-apply the red name for a returning player who is still flagged.
on('playerJoin', ({ player }) => {
  // A save holding `pkUntil`, the flag's end time, is converted.
  const until = getPlayerData(player, 'pkUntil');
  if (typeof until === 'number') {
    setPlayerData(player, LEFT, Math.max(0, until - Date.now()));
    setPlayerData(player, 'pkUntil', undefined);
  }
  if (isPk(player))
    setCosmetic(player, 'nameColor', PK_SOURCE, 'red', PK_PRIORITY);
});

// Run the flag down (~every 5s), for whoever is in the game.
on('tick', ({ tick }) => {
  if (tick % SWEEP_TICKS !== 0) return;
  for (const p of getPlayers()) {
    const left = Number(getPlayerData(p, LEFT)) || 0;
    if (left > sweepMs) setPlayerData(p, LEFT, left - sweepMs);
    else if (getPlayerData(p, LEFT) != null) unflag(p);
  }
});

command(
  'pk',
  { description: 'Show your player-killer status' },
  ({ player, reply }) => {
    if (!player) return reply('In-game only.');
    const kills = Number(getPlayerData(player, 'pkCount')) || 0;
    reply(
      isPk(player)
        ? t(player, 'You are flagged as a PK ({kills} kills).', { kills })
        : t(player, 'Not flagged. Kills: {kills}.', { kills }),
    );
  },
);

provide('pk', { isPk });

log('PK module ready (flagMinutes=' + flagMs / 60000 + ').');
