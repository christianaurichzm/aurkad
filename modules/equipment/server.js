// @ts-check
// Equipment module: set bonuses on top of core equipment effects, applied
// on equip and unequip when the required pieces are worn.

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

function applyEffect(player, effect, reverse) {
  if (!effect || !effect.attribute || !Number.isFinite(effect.value)) return;
  const attr = effect.attribute;
  if (typeof player[attr] !== 'number') return;

  if (effect.type === 'multiply') {
    if (effect.value === 0) return;
    player[attr] = reverse
      ? player[attr] / effect.value
      : player[attr] * effect.value;
  } else {
    player[attr] += reverse ? -effect.value : effect.value;
  }
}

function sameBonuses(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
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

  for (const bonus of current) {
    for (const effect of bonus.effects || []) applyEffect(player, effect, true);
  }
  for (const bonus of next) {
    for (const effect of bonus.effects || [])
      applyEffect(player, effect, false);
  }

  setPlayerData(player, dataKey, next);
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
    reply(`Active sets: ${active.map((set) => set.name).join(', ')}`);
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
