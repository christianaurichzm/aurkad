// Magic module, server entry: spells in a module registry, mana in the
// data bag, cooldowns in a runtime map. The client hotbar casts through
// the spell:cast custom action.
//
//   const magic = use('magic');
//   magic.defineSpell({ id, name, cost, cooldownMs, cast(caster) { ... } });

const manaMax = (config && config.manaMax) || 100;
const regenPerSec = (config && config.manaRegenPerSec) || 5;
const blastRadius = (config && config.blastRadius) || 120;

const spells = new Map();
const cooldowns = {}; // playerName -> { spellId: readyAtMs }

const getMana = (p) => {
  const m = getPlayerData(p, 'mana');
  return typeof m === 'number' ? m : manaMax;
};
const setMana = (p, v) => setPlayerData(p, 'mana', Math.max(0, Math.min(manaMax, v)));

function pushState(player) {
  const cd = cooldowns[player.name] || {};
  sendEvent(player, 'magic:update', {
    mana: getMana(player),
    manaMax,
    spells: [...spells.values()].map((s) => ({
      id: s.id,
      name: s.name,
      cost: s.cost,
      readyAt: cd[s.id] || 0,
    })),
  });
}

function defineSpell(spell) {
  spells.set(spell.id, spell);
}

function cast(player, spellId) {
  const spell = spells.get(spellId);
  if (!spell) return false;

  const now = Date.now();
  const cd = cooldowns[player.name] || (cooldowns[player.name] = {});
  if ((cd[spellId] || 0) > now) return false; // on cooldown

  const mana = getMana(player);
  if (mana < spell.cost) return false; // not enough mana

  try {
    spell.cast(player);
  } catch (e) {
    error('spell "' + spellId + '" threw: ' + e);
    return false;
  }

  sendMapEvent(player.mapId, 'spell:visual', {
    x: player.position.x,
    y: player.position.y,
    sprite: spell.sprite || 0,
  });

  setMana(player, mana - spell.cost);
  cd[spellId] = now + (spell.cooldownMs || 0);
  pushState(player);
  return true;
}

// --- Built-in spells ---------------------------------------------------------

defineSpell({
  id: 'blast',
  name: 'Arcane Blast',
  sprite: 0,
  cost: 30,
  cooldownMs: 3000,
  cast: (caster) => {
    for (const npc of getNearbyNpcs(caster.mapId, caster.position.x, caster.position.y, blastRadius)) {
      dealDamage(npc, 15, caster);
    }
  },
});

defineSpell({
  id: 'heal',
  name: 'Heal',
  sprite: 1,
  cost: 25,
  cooldownMs: 5000,
  cast: (caster) => healPlayer(caster),
});

// --- Wiring ------------------------------------------------------------------

on('customAction', ({ player, channel, payload }) => {
  if (channel === 'spell:cast' && payload && typeof payload.id === 'string') {
    cast(player, payload.id);
  } else if (channel === 'magic:request') {
    pushState(player);
  }
});

// Regenerate mana ~once per second.
on('tick', ({ tick }) => {
  if (tick % 20 !== 0) return;
  for (const p of getPlayers()) {
    const m = getMana(p);
    if (m < manaMax) {
      setMana(p, m + regenPerSec);
      pushState(p);
    }
  }
});

provide('magic', { defineSpell, cast });

log('Magic module ready (manaMax=' + manaMax + ').');
