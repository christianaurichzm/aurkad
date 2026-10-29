// @ts-check
// Achievements: named milestones counted off npcDeath, playerLevelUp and
// inventoryChange. Anything else a game awards through the provided API.
//
// Definitions come from game.json and are validated at boot. Progress lives
// in `player.data.achievements`, with one counter per rule, so kill 1 and
// kill 50 share a number.

i18n({
  pt: {
    'Achievement unlocked: {name}': 'Conquista desbloqueada: {name}',
    'Achievements: {earned}/{total}': 'Conquistas: {earned}/{total}',
    'No achievements defined.': 'Nenhuma conquista definida.',
    'Achievement commands must be used in-game.':
      'Os comandos de conquista só funcionam dentro do jogo.',
  },
  es: {
    'Achievement unlocked: {name}': 'Logro desbloqueado: {name}',
    'Achievements: {earned}/{total}': 'Logros: {earned}/{total}',
    'No achievements defined.': 'No hay logros definidos.',
    'Achievement commands must be used in-game.':
      'Los comandos de logros solo funcionan dentro del juego.',
  },
});

const KEY = 'achievements';

/** A definition earns its place only if something can move it. */
function normalize(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) {
    warn(`achievement #${index} has no id; skipped`);
    return null;
  }
  const count = Math.max(1, Number(raw.count) || 1);
  const def = {
    id,
    name: String(raw.name || id),
    description: String(raw.description || ''),
    count,
    rule: null,
  };

  if (typeof raw.kill === 'string' && raw.kill)
    def.rule = { kind: 'kill', of: raw.kill };
  else if (Number.isFinite(Number(raw.level)))
    def.rule = { kind: 'level', at: Math.max(1, Number(raw.level)) };
  else if (Number.isFinite(Number(raw.collect)))
    def.rule = { kind: 'collect', of: Number(raw.collect) };
  else if (raw.manual !== true) {
    warn(`achievement "${id}" has no rule and is not marked manual; skipped`);
    return null;
  }
  return def;
}

const defs = /** @type {any[]} */ (
  Array.isArray(config && config.achievements) ? config.achievements : []
)
  .map(normalize)
  .filter(Boolean);

const byId = new Map(defs.map((def) => [def.id, def]));

/** Counter key per rule, so achievements on the same rule share progress. */
const counterKey = (rule) =>
  rule.kind === 'kill' ? `kill:${rule.of}` : `collect:${rule.of}`;

function stateOf(player) {
  const stored = /** @type {any} */ (getPlayerData(player, KEY));
  const earned =
    stored && Array.isArray(stored.earned)
      ? stored.earned.filter((id) => typeof id === 'string')
      : [];
  const counters =
    stored && stored.counters && typeof stored.counters === 'object'
      ? { ...stored.counters }
      : {};
  // id -> epoch ms. An achievement stored without a date shows none.
  const at =
    stored && stored.at && typeof stored.at === 'object'
      ? { ...stored.at }
      : {};
  return { earned, counters, at };
}

const save = (player, state) => setPlayerData(player, KEY, state);

function push(player, state) {
  const current = state || stateOf(player);
  sendEvent(player, 'achievements:update', {
    earned: current.earned,
    at: current.at,
    all: defs.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      target: def.count,
      progress: def.rule
        ? Math.min(
            def.count,
            Number(current.counters[counterKey(def.rule)]) || 0,
          )
        : 0,
    })),
  });
}

/** The one place an achievement is granted, whatever moved it. */
function award(player, id, state) {
  const def = byId.get(id);
  if (!def) return false;
  const current = state || stateOf(player);
  if (current.earned.includes(id)) return false;

  current.earned.push(id);
  current.at[id] = Date.now();
  if (!save(player, current)) return false;

  sendMessage(
    player,
    t(player, 'Achievement unlocked: {name}', { name: def.name }),
  );
  sendEvent(player, 'achievements:earned', {
    id: def.id,
    name: def.name,
    description: def.description,
  });
  push(player, current);
  return true;
}

/**
 * Adds to one rule's counter and awards everything it completes. Level does
 * not come through here, since the player already carries it.
 */
function bump(player, rule, by) {
  if (by <= 0) return;
  const state = stateOf(player);
  const key = counterKey(rule);
  const total = (Number(state.counters[key]) || 0) + by;
  state.counters[key] = total;

  const completed = defs.filter(
    (def) =>
      def.rule &&
      def.rule.kind === rule.kind &&
      counterKey(def.rule) === key &&
      total >= def.count &&
      !state.earned.includes(def.id),
  );

  if (completed.length === 0) {
    save(player, state);
    push(player, state);
    return;
  }
  save(player, state);
  for (const def of completed) award(player, def.id, stateOf(player));
}

on('npcDeath', ({ npc, killer }) => {
  if (!killer) return;
  bump(killer, { kind: 'kill', of: '*' }, 1);
  if (npc.name) bump(killer, { kind: 'kill', of: npc.name }, 1);
});

// Counted from the bag, like a quest's collect objective, so a stack dropped
// and picked up again counts once. The counter keeps the most ever held,
// since spending the item takes no progress back.
on('inventoryChange', ({ player }) => {
  for (const { rule } of defs) {
    if (!rule || rule.kind !== 'collect') continue;
    const counted = Number(stateOf(player).counters[counterKey(rule)]) || 0;
    bump(player, rule, countItem(player, rule.of) - counted);
  }
});

on('playerLevelUp', ({ player, level }) => {
  for (const def of defs) {
    if (def.rule && def.rule.kind === 'level' && level >= def.rule.at)
      award(player, def.id, stateOf(player));
  }
  push(player);
});

on('customAction', ({ player, channel }) => {
  if (channel === 'achievements:request') push(player);
});

command(
  'achievements',
  { description: 'Your achievements: /achievements' },
  ({ player, reply }) => {
    if (!player) return reply('Achievement commands must be used in-game.');
    if (defs.length === 0) return reply('No achievements defined.');
    reply(
      t(player, 'Achievements: {earned}/{total}', {
        earned: stateOf(player).earned.length,
        total: defs.length,
      }),
    );
  },
);

provide('achievements', {
  /** Grants one by id, for a rule this module does not count. */
  award: (player, id) => award(player, id),
  earned: (player) => stateOf(player).earned,
  has: (player, id) => stateOf(player).earned.includes(id),
  definitions: () => defs.map((def) => ({ ...def })),
});

log(`Achievements module ready (${defs.length} defined).`);
