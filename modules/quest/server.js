// @ts-check
// Quest module: definitions in a module registry, per-player progress in
// the data bag, and quest:update pushed to the client's quest log.
//
//   const quest = use('quest');
//   quest.define({ id: 'hunt', name: 'Hunt', target: 5,
//     reward: (p) => giveExperience(p, 100) });
//   quest.start(player, 'hunt');
//   quest.advance(player, 'hunt', 1);
//
// A script's define() owns the whole quest. A quest authored in the editor
// is read through getQuest() when needed and advanced by the hook its
// objective type names. A script defining the same id wins.

i18n({
  pt: {
    'Your bag is full - the reward was mailed to you.':
      'Sua bolsa está cheia - a recompensa foi enviada pelo correio.',
  },
});

const defs = new Map(); // define()d by scripts

const targetOf = (objective) =>
  objective.type === 'talk' || objective.type === 'reach' ? 1 : objective.count;

function defOf(id) {
  const scripted = defs.get(id);
  if (scripted) return scripted;
  const q = getQuest(id);
  return (
    q && {
      id: q.id,
      name: q.name,
      description: q.description || '',
      target: targetOf(q.objective),
      objective: q.objective,
      reward: q.reward,
    }
  );
}

const bagOf = (player) => getPlayerData(player, 'quests') || {};

// A declared reward in words the client can show without a content lookup of
// its own. A script's reward is a function, and says nothing until it runs.
function rewardOf(id) {
  const reward = defOf(id)?.reward;
  if (!reward || typeof reward !== 'object') return undefined;
  return {
    experience: reward.experience || 0,
    items: (reward.items || []).map((entry) => {
      const item = getItem(entry.itemId);
      return {
        name: item?.name ?? `#${entry.itemId}`,
        sprite: item?.sprite ?? 0,
        quantity: entry.quantity || 1,
      };
    }),
  };
}

// False when player data refused the write, which leaves the client's log
// as it was.
function save(player, bag) {
  if (!setPlayerData(player, 'quests', bag)) return false; // persists with the player
  const list = Object.keys(bag).map((id) =>
    Object.assign({ id, reward: rewardOf(id) }, bag[id]),
  );
  sendEvent(player, 'quest:update', list);
  return true;
}

// A reward the player cannot hold is the failure this guards: the quest is
// completed either way, so an item that does not fit goes to the mailbox rather
// than nowhere. Queueing is a database write, hence the promise in a hook.
function payItems(player, items) {
  for (const entry of items) {
    const quantity = entry.quantity || 1;
    if (giveItem(player, entry.itemId, quantity)) continue;
    sendMessage(player, 'Your bag is full - the reward was mailed to you.');
    delivery
      .queue({ to: player.name, itemId: entry.itemId, quantity })
      .then((r) => {
        if (!r.ok) error('quest reward delivery refused: ' + r.reason);
      })
      .catch((e) => error('quest reward delivery threw: ' + e));
  }
}

function finish(player, id, bag) {
  bag[id].status = 'completed';
  // Stored before paying, or a refused write lets the next kill pay again.
  if (!save(player, bag)) return;
  const def = defOf(id);
  if (!def) return;
  // A script's reward is a function. An authored one describes the reward
  // and may name a handler, run last, for what a document cannot say.
  if (typeof def.reward === 'function') {
    try {
      def.reward(player);
    } catch (e) {
      error('quest reward threw: ' + e);
    }
    return;
  }
  if (!def.reward) return;
  if (def.reward.experience) giveExperience(player, def.reward.experience);
  if (def.reward.items) payItems(player, def.reward.items);
  if (def.reward.script) {
    const handler = use('questReward.' + def.reward.script);
    if (typeof handler !== 'function') {
      error('quest ' + id + ' names unregistered reward ' + def.reward.script);
      return;
    }
    try {
      handler({ player, quest: def });
    } catch (e) {
      error('quest reward threw: ' + e);
    }
  }
}

function define(def) {
  defs.set(def.id, def);
}

// Returns false if the quest is undefined or the player already has it.
// `from` is who gave it, for the quest log to say; a script may leave it out.
function start(player, id, from) {
  const def = defOf(id);
  if (!def) return false;
  const bag = bagOf(player);
  if (bag[id]) return false;
  bag[id] = {
    name: def.name,
    description: def.description || '',
    progress: 0,
    target: def.target || 1,
    status: 'active',
    from: typeof from === 'string' ? from : undefined,
  };
  return save(player, bag);
}

function advance(player, id, amount) {
  const step = amount == null ? 1 : amount;
  const bag = bagOf(player);
  const q = bag[id];
  if (!q || q.status === 'completed') return;
  q.progress = Math.min(q.target, q.progress + step);
  if (q.progress >= q.target) finish(player, id, bag);
  else save(player, bag);
}

function complete(player, id) {
  const bag = bagOf(player);
  const q = bag[id];
  if (!q || q.status === 'completed') return;
  q.progress = q.target;
  finish(player, id, bag);
}

const get = (player, id) => bagOf(player)[id];

provide('quest', { define, start, advance, complete, get });

on('playerJoin', ({ player }) => {
  const bag = bagOf(player);
  if (Object.keys(bag).length > 0) save(player, bag);
});

on('customAction', ({ player, channel }) => {
  if (channel === 'quest:request') {
    save(player, bagOf(player));
  }
});

// ─── AUTHORED QUESTS ─────────────────────────────────────────────────────────

/** The authored quests this player has open, so a hook only walks their own. */
function activeObjectives(player, type) {
  const bag = bagOf(player);
  const out = [];
  for (const id of Object.keys(bag)) {
    if (bag[id].status !== 'active') continue;
    const def = defOf(id);
    if (def && def.objective && def.objective.type === type) {
      out.push({ id, objective: def.objective });
    }
  }
  return out;
}

// A map-spawned npc's id is "<map>:<template>:<row>:<col>", so objectives
// match on templateId.
const contentIdOf = (npc) => npc.templateId || npc.id;

on('npcDeath', ({ npc, killer }) => {
  if (!killer) return;
  const target = contentIdOf(npc);
  for (const { id, objective } of activeObjectives(killer, 'kill')) {
    if (objective.npcId === target) advance(killer, id, 1);
  }
});

on('itemPickup', ({ player, itemId }) => {
  // Counted from the inventory, not per pickup, so dropping and picking up
  // again does not count twice.
  for (const { id, objective } of activeObjectives(player, 'collect')) {
    if (objective.itemId !== itemId) continue;
    const bag = bagOf(player);
    const q = bag[id];
    if (!q) continue;
    q.progress = Math.min(q.target, countItem(player, itemId));
    if (q.progress >= q.target) finish(player, id, bag);
    else save(player, bag);
  }
});

on('tileEnter', ({ player, map }) => {
  const row = Math.round(player.position.y / TILE_SIZE);
  const col = Math.round(player.position.x / TILE_SIZE);
  // A dungeon copy is keyed "<map>#<suffix>", and the objective names the map.
  const mapId = String(map.id).split('#')[0];
  for (const { id, objective } of activeObjectives(player, 'reach')) {
    if (
      objective.mapId === mapId &&
      objective.row === row &&
      objective.col === col
    ) {
      complete(player, id);
    }
  }
});

on('npcInteract', ({ player, npc }) => {
  const target = contentIdOf(npc);
  // Advance before offering, or an npc that gives a quest and is also its
  // talk target would complete it at once.
  for (const { id, objective } of activeObjectives(player, 'talk')) {
    if (objective.npcId === target) complete(player, id);
  }
  if (npc.questId) start(player, npc.questId, npc.name);
});

// A dialog choice with the action `questStart:<id>` starts a quest; the
// dialog module splits the id off and hands it over.
provide('dialogAction.questStart', ({ player, arg, npc }) => {
  if (arg) start(player, arg, npc?.name);
});

log(`Quest module ready (${getQuests().length} authored).`);
