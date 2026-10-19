// @ts-check
// Equipment module: set bonuses on top of core equipment effects, applied
// on equip and unequip when the required pieces are worn.

i18n({
  pt: {
    'Set commands must be used in-game.':
      'Os comandos de conjunto só funcionam dentro do jogo.',
    'No active equipment sets.': 'Nenhum conjunto ativo.',
    'Active sets: {sets}': 'Conjuntos ativos: {sets}',
  },
});

const dataKey = 'equipmentSetBonuses';
const sets = new Map();

function defineSet(set) {
  if (!set || !set.id || !Array.isArray(set.pieces)) return false;
  sets.set(String(set.id), {
    id: String(set.id),
    name: String(set.name || set.id),
    pieces: set.pieces
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
    minPieces: Math.max(
      1,
      Math.floor(Number(set.minPieces || set.pieces.length)),
    ),
    effects: Array.isArray(set.effects) ? set.effects.slice() : [],
  });
  for (const player of getPlayers()) reconcile(player);
  return true;
}

const configuredSets = config && Array.isArray(config.sets) ? config.sets : [];
for (const set of configuredSets) defineSet(set);

function equippedIds(player) {
  return Object.values(player.equipped || {})
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function activeDefinitions(player) {
  const equipped = equippedIds(player);
  return [...sets.values()].filter((set) => {
    const worn = set.pieces.filter((id) => equipped.includes(id)).length;
    return worn >= set.minPieces;
  });
}

function activeSets(player) {
  return activeDefinitions(player).map((set) => ({
    id: set.id,
    name: set.name,
    effects: set.effects.map((effect) => ({
      attribute: effect.attribute,
      type: effect.type,
      value: Number(effect.value),
    })),
  }));
}

// What a set's effects add to `stats` now, as fixed amounts like core
// equipment records, since dividing out a multiplier later is not exact.
function contribution(stats, effects) {
  const after = new Map();
  for (const { attribute, type, value } of effects) {
    if (typeof stats[attribute] !== 'number' || !Number.isFinite(value))
      continue;
    const current = after.get(attribute) ?? stats[attribute];
    after.set(
      attribute,
      type === 'multiply' ? current * value : current + value,
    );
  }
  return [...after].map(([attribute, value]) => ({
    attribute,
    value: value - stats[attribute],
  }));
}

function sameBonuses(stored, next) {
  const definitions = stored.map(({ id, name, effects }) => ({
    id,
    name,
    effects,
  }));
  return JSON.stringify(definitions) === JSON.stringify(next);
}

function reconcile(player, { forceSync = false } = {}) {
  const stored = getPlayerData(player, dataKey);
  const current = Array.isArray(stored) ? stored : [];
  const next = activeSets(player);
  if (sameBonuses(current, next)) {
    if (forceSync)
      sendEvent(player, 'equipment:update', {
        activeSets: next,
        sets: [...sets.values()],
      });
    return next;
  }

  // Worked out on a copy and recorded before the stats move, so a refused
  // write cannot apply the bonuses twice.
  const stats = { ...player };
  for (const bonus of current) {
    for (const { attribute, value } of bonus.applied || [])
      stats[attribute] -= value;
  }
  const record = next.map((set) => {
    const applied = contribution(stats, set.effects);
    for (const { attribute, value } of applied) stats[attribute] += value;
    return { ...set, applied };
  });
  if (!setPlayerData(player, dataKey, record)) return current;
  for (const bonus of [...current, ...record]) {
    for (const { attribute } of bonus.applied || [])
      player[attribute] = stats[attribute];
  }
  player.health = Math.max(0, Math.min(player.health, player.maxHealth));

  sendEvent(player, 'equipment:update', {
    activeSets: next,
    sets: [...sets.values()],
  });
  return next;
}

command(
  'sets',
  { description: 'Show active equipment set bonuses.' },
  ({ player, reply }) => {
    if (!player) return reply('Set commands must be used in-game.');
    const active = reconcile(player);
    if (!active.length) return reply('No active equipment sets.');
    reply(
      t(player, 'Active sets: {sets}', {
        sets: active.map((set) => set.name).join(', '),
      }),
    );
  },
);

on('customAction', ({ player, channel }) => {
  if (channel === 'equipment:request') reconcile(player, { forceSync: true });
});

on('playerJoin', ({ player }) => reconcile(player, { forceSync: true }));

// Only equipping changes what a set is worth, so the module reconciles on
// equip events. A swap fires unequip then equip and reconciles twice.
on('itemEquip', ({ player }) => reconcile(player));
on('itemUnequip', ({ player }) => reconcile(player));

provide('equipment', {
  defineSet,
  reconcile,
  activeSets,
  sets: () => [...sets.values()],
});

log(`Equipment module ready (${sets.size} sets).`);
