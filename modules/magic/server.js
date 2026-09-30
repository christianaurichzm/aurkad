// @ts-check
// Magic module, server entry: spells in a module registry, mana in the
// data bag, cooldowns in a runtime map. The client hotbar casts through
// the spell:cast custom action.
//
//   const magic = use('magic');
//   magic.defineSpell({ id, name, cost, cooldownMs, cast(caster) { ... } });
//   magic.setSpells(player, ['fireball', 'frost']); // undefined: all again
//
// Spells from SpellEditor load at startup with a default cast by `target`:
// 'enemies' damages npcs in range, 'self' heals the caster, 'party' and
// 'guild' heal allies in range. With manualVisual:true the cast function
// sends its own visuals.
//
// `startingSpells` in config is what a new character can cast (unset:
// everything). Dialogs teach with `learnSpell:<id>` and test with
// `lacksSpell:<id>` or `knowsSpell:<id>`, and a tome is a consumable whose
// behaviour is `learnSpell`.

const manaMax = Number((config && config.manaMax) || 100);
const regenPerSec = Number((config && config.manaRegenPerSec) || 5);
const blastRadius = Number((config && config.blastRadius) || 120);
const starting = config && config.startingSpells;
const startingSpells = Array.isArray(starting) ? starting.map(String) : null;

i18n({
  pt: {
    'You learned {spell}.': 'Você aprendeu {spell}.',
    'You already know {spell}.': 'Você já conhece {spell}.',
  },
});

const spells = new Map();
const cooldowns = {}; // playerName -> { spellId: readyAtMs }

const getMana = (p) => {
  const m = getPlayerData(p, 'mana');
  return typeof m === 'number' ? m : manaMax;
};
const setMana = (p, v) =>
  setPlayerData(p, 'mana', Math.max(0, Math.min(manaMax, v)));

// The ids a player may cast, or null for all of them.
function spellbook(player) {
  const list = getPlayerData(player, 'spells');
  return Array.isArray(list) ? new Set(list.map(String)) : null;
}

const iconOf = (s) =>
  typeof s.icon === 'number'
    ? s.icon
    : typeof s.sprite === 'number'
      ? s.sprite + Math.floor((s.frames || 1) / 3)
      : undefined;

function pushState(player) {
  const cd = cooldowns[player.name] || {};
  const book = spellbook(player);
  sendEvent(player, 'magic:update', {
    mana: getMana(player),
    manaMax,
    spells: [...spells.values()]
      .filter((s) => !book || book.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        icon: iconOf(s),
        cost: s.cost,
        readyAt: cd[s.id] || 0,
        friendly: s.target ? s.target !== 'enemies' : s.visualTarget === 'self',
        // The whole duration, so the slot can show the share left.
        cooldownMs: s.cooldownMs || 0,
      })),
  });
}

function defineSpell(spell) {
  spells.set(spell.id, spell);
}

function cast(player, spellId) {
  const spell = spells.get(spellId);
  if (!spell) return false;
  const book = spellbook(player);
  if (book && !book.has(spellId)) return false; // not one of theirs

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
      frames: spell.frames,
    });
  }

  setMana(player, mana - spell.cost);
  cd[spellId] = now + (spell.cooldownMs || 0);
  pushState(player);
  return true;
}

// --- Helper for building cast functions --------------------------------------

// A spell with no `target` aims at enemies when it deals damage and
// otherwise heals the caster.
const targetOf = (s) => s.target || (s.damage > 0 ? 'enemies' : 'self');

// Names in the caster's party or guild; none when the caster has neither or
// the module is off.
function groupNames(caster, kind) {
  if (kind === 'party') {
    const party = use('party');
    return party ? party.members(caster) : [];
  }
  const guild = use('guild');
  const g = guild && guild.guildOf(caster);
  return g ? guild.members(g.name) : [];
}

// The caster's party or guild on this map within blast range, the caster
// included. With no group the caster heals alone.
function alliesAround(caster, kind) {
  const near = groupNames(caster, kind)
    .map((name) => getPlayer(name))
    .filter(
      (p) =>
        p &&
        p.health > 0 &&
        p.mapId === caster.mapId &&
        Math.hypot(
          p.position.x - caster.position.x,
          p.position.y - caster.position.y,
        ) <= blastRadius,
    );
  return near.length > 0 ? near : [caster];
}

// visualTarget: 'self'    → effect on the caster
//               'targets' → effect on each enemy hit or ally healed
function makeCast(s) {
  const target = targetOf(s);
  const visualTarget =
    s.visualTarget || (target === 'self' ? 'self' : 'targets');
  return function (caster) {
    let affected;
    if (target === 'enemies') {
      affected = getNearbyNpcs(
        caster.mapId,
        caster.position.x,
        caster.position.y,
        blastRadius,
      );
      for (const npc of affected) dealDamage(npc, s.damage, caster);
    } else {
      affected = target === 'self' ? [caster] : alliesAround(caster, target);
      // 0 heals to full.
      for (const p of affected) healPlayer(p, s.heal || undefined);
    }
    const visualPositions =
      visualTarget === 'targets' && affected.length > 0
        ? affected.map((t) => t.position)
        : [caster.position];
    for (const pos of visualPositions) {
      sendMapEvent(caster.mapId, 'spell:visual', {
        x: pos.x,
        y: pos.y,
        sprite: s.sprite,
        frames: s.frames,
      });
    }
  };
}

function defineFromData(id, s) {
  defineSpell({
    id,
    name: s.name,
    description: s.description,
    sprite: s.sprite,
    frames: s.frames,
    icon: s.icon,
    cost: s.mpCost,
    cooldownMs: s.cooldownMs,
    manualVisual: true,
    target: targetOf(s),
    cast: makeCast(s),
  });
}

// --- Load spells from DB -----------------------------------------------------

const dbSpells = getSpells();
if (dbSpells.length > 0) {
  for (const s of dbSpells) defineFromData(String(s.id), s);
  log('Loaded ' + dbSpells.length + ' spell(s) from database.');
} else {
  // No spells in the database yet: define the built-ins in memory and seed
  // the database so they appear in SpellEditor on next reload.
  const builtins = [
    {
      id: 'blast',
      name: 'Arcane Blast',
      description: 'Deals damage to nearby enemies.',
      sprite: 0,
      mpCost: 30,
      damage: 15,
      cooldownMs: 3000,
    },
    {
      id: 'heal',
      name: 'Heal',
      description: 'Restores the caster to full HP.',
      sprite: 1,
      mpCost: 25,
      damage: 0,
      cooldownMs: 5000,
    },
  ];

  for (const s of builtins) defineFromData(s.id, s);
  createSpells(builtins);

  log(
    'No DB spells found - seeded built-ins. Edit them in SpellEditor and restart to apply.',
  );
}

// --- Wiring ------------------------------------------------------------------

on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  if (channel === 'spell:cast' && data && typeof data.id === 'string') {
    cast(player, data.id);
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

/** What `player` can cast, as spell ids; undefined gives every spell back. */
function setSpells(player, ids) {
  setPlayerData(player, 'spells', ids && ids.map(String));
  pushState(player);
}

function knows(player, spellId) {
  const book = spellbook(player);
  return spells.has(String(spellId)) && (!book || book.has(String(spellId)));
}

/**
 * Adds a spell to what `player` can cast. False when they can cast it already,
 * which with no list of their own is every spell; throws on an id no spell
 * has, so a dialog naming a deleted spell stops instead of moving on to "now
 * you know it".
 */
function learn(player, spellId) {
  const spell = spells.get(String(spellId));
  if (!spell) throw new Error('no spell ' + spellId);
  if (knows(player, spell.id)) return false;
  setSpells(player, [...(spellbook(player) || []), spell.id]);
  sendMessage(player, t(player, 'You learned {spell}.', { spell: spell.name }));
  return true;
}

// Only a character with no list yet gets the starting spells.
on('playerJoin', ({ player }) => {
  if (startingSpells && !spellbook(player)) setSpells(player, startingSpells);
});

provide('dialogAction.learnSpell', ({ player, arg }) => {
  learn(player, arg);
});
provide('dialogCondition.knowsSpell', ({ player, arg }) => knows(player, arg));
provide('dialogCondition.lacksSpell', ({ player, arg }) => !knows(player, arg));

// The editor lists the spells defined by the time this runs; one a
// script defines later is taught by id from a dialog, or with setSpells.
const teachable = [...spells.values()];
attach('learnSpell', {
  params: {
    spell: {
      type: 'select',
      label: 'Spell',
      options: teachable.map((s) => s.id),
      optionLabels: teachable.map((s) => s.name),
    },
  },
  onUse({ player, params, refuse }) {
    const spell = spells.get(String(params.spell));
    if (spell && !knows(player, spell.id)) {
      learn(player, spell.id);
      return;
    }
    refuse();
    if (!spell) throw new Error('tome names no spell: ' + params.spell);
    sendMessage(
      player,
      t(player, 'You already know {spell}.', { spell: spell.name }),
    );
  },
});

provide('magic', { defineSpell, cast, setSpells, learn });

log('Magic module ready (manaMax=' + manaMax + ').');
