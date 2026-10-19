// @ts-check
// Status module: timed buffs and debuffs in player data that change damage
// dealt or taken, or heal or hurt on a tick.

i18n({
  pt: {
    'Player not found.': 'Jogador não encontrado.',
    'Status applied.': 'Status aplicado.',
    'Unknown status.': 'Status desconhecido.',
    'Status cleared.': 'Status removido.',
    'Status not found.': 'Status não encontrado.',
    'Statuses: {list}': 'Status: {list}',
    none: 'nenhum',
    'Usage: /status apply|clear|list <player> [effect]':
      'Uso: /status apply|clear|list <jogador> [efeito]',
  },
});

const dataKey = 'statusEffects';
let currentTick = 0;

const definitions = new Map();
const builtIns = {
  shield: { name: 'Shield', durationTicks: 100, incomingDamageMultiplier: 0.5 },
  fury: { name: 'Fury', durationTicks: 100, outgoingDamageMultiplier: 1.5 },
  regen: {
    name: 'Regen',
    durationTicks: 100,
    tickInterval: 20,
    healPerTick: 5,
  },
  poison: {
    name: 'Poison',
    durationTicks: 100,
    tickInterval: 20,
    damagePerTick: 3,
  },
};

function define(id, definition) {
  if (!id || !definition) return false;
  definitions.set(String(id), { id: String(id), ...definition });
  return true;
}

for (const id of Object.keys(builtIns)) define(id, builtIns[id]);
for (const id of Object.keys((config && config.effects) || {}))
  define(id, config.effects[id]);

// Expiry is a tick counted from this process's boot, so a status saved
// before a restart or on another instance may name a far-off tick. None
// outlasts its duration from now; after a restart one may run it again.
function list(player) {
  const stored = getPlayerData(player, dataKey);
  return (Array.isArray(stored) ? stored : [])
    .filter((status) => status && status.id)
    .map((status) => {
      const latest =
        currentTick +
        Math.max(0, Math.floor(Number(status.durationTicks) || 0));
      return status.expiresAt > latest
        ? { ...status, expiresAt: latest }
        : status;
    });
}

function pushStatus(player, statuses) {
  sendEvent(player, 'status:update', { tick: currentTick, statuses });
}

function save(player, statuses) {
  setPlayerData(player, dataKey, statuses);
  pushStatus(player, statuses);
}

function publicStatus(status) {
  return {
    id: String(status.id),
    name: String(status.name || status.id),
    durationTicks: Math.max(0, Math.floor(Number(status.durationTicks) || 0)),
    expiresAt: Math.max(
      currentTick,
      Math.floor(Number(status.expiresAt || currentTick)),
    ),
    incomingDamageMultiplier:
      status.incomingDamageMultiplier === undefined
        ? undefined
        : Number(status.incomingDamageMultiplier),
    outgoingDamageMultiplier:
      status.outgoingDamageMultiplier === undefined
        ? undefined
        : Number(status.outgoingDamageMultiplier),
    tickInterval:
      status.tickInterval === undefined
        ? undefined
        : Math.max(1, Math.floor(Number(status.tickInterval))),
    healPerTick:
      status.healPerTick === undefined ? undefined : Number(status.healPerTick),
    damagePerTick:
      status.damagePerTick === undefined
        ? undefined
        : Number(status.damagePerTick),
  };
}

function apply(player, idOrStatus, overrides) {
  const base =
    typeof idOrStatus === 'string' ? definitions.get(idOrStatus) : idOrStatus;
  if (!base) return false;

  const merged = { ...base, ...(overrides || {}) };
  const duration = Math.max(1, Math.floor(Number(merged.durationTicks || 100)));
  const status = publicStatus({
    ...merged,
    durationTicks: duration,
    expiresAt: currentTick + duration,
  });
  const statuses = list(player).filter((entry) => entry.id !== status.id);
  statuses.push(status);
  save(player, statuses);
  return true;
}

function clear(player, id) {
  if (!id) {
    save(player, []);
    return true;
  }
  const before = list(player);
  const after = before.filter((status) => status.id !== id);
  if (after.length === before.length) return false;
  save(player, after);
  return true;
}

// Saves when anything expired or was capped, since an expiry corrected
// only in memory would be corrected again on every read.
function prune(player) {
  const after = list(player).filter(
    (status) => !status.expiresAt || status.expiresAt > currentTick,
  );
  const stored = getPlayerData(player, dataKey);
  if (JSON.stringify(after) !== JSON.stringify(stored || [])) {
    save(player, after);
  }
  return after;
}

function multiplier(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

command(
  'status',
  {
    access: Access.MOD,
    description: 'Status: /status apply|clear|list <player> [effect]',
  },
  ({ player, args, reply }) => {
    const sub = String(args[0] || '').toLowerCase();
    const target = getPlayer(args[1] || '');
    if (!target) return reply('Player not found.');
    if (sub === 'apply')
      return reply(
        apply(target, args[2]) ? 'Status applied.' : 'Unknown status.',
      );
    if (sub === 'clear')
      return reply(
        clear(target, args[2]) ? 'Status cleared.' : 'Status not found.',
      );
    if (sub === 'list')
      return reply(
        t(player, 'Statuses: {list}', {
          list:
            list(target)
              .map((s) => s.id)
              .join(', ') || t(player, 'none'),
        }),
      );
    reply('Usage: /status apply|clear|list <player> [effect]');
  },
);

on('customAction', ({ player, channel }) => {
  if (channel === 'status:request') pushStatus(player, prune(player));
});

on('beforeDamage', ({ attacker, target, damage }) => {
  if (attacker && attacker.kind === 'player') {
    for (const status of prune(attacker)) {
      damage.value *= multiplier(status.outgoingDamageMultiplier, 1);
    }
  }
  if (target && target.kind === 'player') {
    for (const status of prune(target)) {
      damage.value *= multiplier(status.incomingDamageMultiplier, 1);
    }
  }
});

on('tick', ({ tick }) => {
  currentTick = tick;
  for (const player of getPlayers()) {
    const statuses = prune(player);
    let touched = false;
    for (const status of statuses) {
      const interval = Math.max(
        1,
        Math.floor(Number(status.tickInterval || 0)),
      );
      if (!interval || tick % interval !== 0) continue;
      const heal = Number(status.healPerTick || 0);
      const damage = Number(status.damagePerTick || 0);
      if (
        Number.isFinite(heal) &&
        heal > 0 &&
        player.health < player.maxHealth
      ) {
        player.health = Math.min(player.maxHealth, player.health + heal);
        touched = true;
      }
      if (Number.isFinite(damage) && damage > 0) dealDamage(player, damage);
    }
    if (touched) setPlayerData(player, dataKey, statuses);
  }
});

provide('status', {
  define,
  apply,
  clear,
  list,
});

log(`Status module ready (${definitions.size} definitions).`);
