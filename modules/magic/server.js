// Magic module, server entry: spells in a module registry, mana in the
// data bag, cooldowns in a runtime map. The client hotbar casts through
// the spell:cast custom action.
//
//   const magic = use('magic');
//   magic.defineSpell({ id, name, cost, cooldownMs, cast(caster) { ... } });
//
// Spells from SpellEditor load at startup with a default cast that deals
// `damage` in an area, or heals when damage is 0. With manualVisual:true
// the cast function sends its own visuals.

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

  // Spells that manage their own per-target visuals set manualVisual:true.
  if (!spell.manualVisual) {
    sendMapEvent(player.mapId, 'spell:visual', {
      x: player.position.x,
      y: player.position.y,
      sprite: spell.sprite || 0,
    });
  }

  setMana(player, mana - spell.cost);
  cd[spellId] = now + (spell.cooldownMs || 0);
  pushState(player);
  return true;
}

// --- Helper for building cast functions --------------------------------------

// visualTarget: 'self'    → effect on the caster (heals, buffs)
//               'targets' → effect on each NPC hit (damage spells)
function makeCast(sprite, damage, visualTarget) {
  return function (caster) {
    const targets = getNearbyNpcs(caster.mapId, caster.position.x, caster.position.y, blastRadius);
    if (damage > 0) {
      for (const npc of targets) {
        dealDamage(npc, damage, caster);
      }
    } else {
      healPlayer(caster);
    }
    const visualPositions = visualTarget === 'targets' && targets.length > 0
      ? targets.map((t) => t.position)
      : [caster.position];
    for (const pos of visualPositions) {
      sendMapEvent(caster.mapId, 'spell:visual', { x: pos.x, y: pos.y, sprite });
    }
  };
}

// --- Load spells from DB -----------------------------------------------------

const dbSpells = getSpells();
if (dbSpells.length > 0) {
  for (const s of dbSpells) {
    defineSpell({
      id: String(s.id),
      name: s.name,
      sprite: s.sprite,
      cost: s.mpCost,
      cooldownMs: s.cooldownMs,
      manualVisual: true,
      cast: makeCast(s.sprite, s.damage, s.visualTarget || (s.damage > 0 ? 'targets' : 'self')),
    });
  }
  log('Loaded ' + dbSpells.length + ' spell(s) from database.');
} else {
  // No spells in the database yet: define the built-ins in memory and seed
  // the database so they appear in SpellEditor on next reload.
  const builtins = [
    { id: 'blast', name: 'Arcane Blast', description: 'Deals damage to nearby enemies.', sprite: 0, mpCost: 30, damage: 15, cooldownMs: 3000 },
    { id: 'heal',  name: 'Heal',         description: 'Restores the caster to full HP.',  sprite: 1, mpCost: 25, damage: 0,  cooldownMs: 5000 },
  ];

  for (const s of builtins) {
    defineSpell({
      id: s.id,
      name: s.name,
      sprite: s.sprite,
      cost: s.mpCost,
      cooldownMs: s.cooldownMs,
      manualVisual: true,
      cast: makeCast(s.sprite, s.damage, s.damage > 0 ? 'targets' : 'self'),
    });
  }
  createSpells(builtins);

  log('No DB spells found - seeded built-ins. Edit them in SpellEditor and restart to apply.');
}

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
