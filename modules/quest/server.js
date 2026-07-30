// @ts-check
// Quest module: definitions in a module registry, per-player progress in
// the data bag, and quest:update pushed to the client's QuestTracker.
//
//   const quest = use('quest');
//   quest.define({ id: 'hunt', name: 'Hunt', target: 5,
//     reward: (p) => giveExperience(p, 100) });
//   quest.start(player, 'hunt');
//   quest.advance(player, 'hunt', 1);

const defs = new Map();

const bagOf = (player) => getPlayerData(player, 'quests') || {};

function save(player, bag) {
  setPlayerData(player, 'quests', bag); // persists with the player
  const list = Object.keys(bag).map((id) => Object.assign({ id }, bag[id]));
  sendEvent(player, 'quest:update', list);
}

function finish(player, id, bag) {
  bag[id].status = 'completed';
  const def = defs.get(id);
  if (def && typeof def.reward === 'function') {
    try {
      def.reward(player);
    } catch (e) {
      error('quest reward threw: ' + e);
    }
  }
}

function define(def) {
  defs.set(def.id, def);
}

// Returns false if the quest is undefined or the player already has it.
function start(player, id) {
  const def = defs.get(id);
  if (!def) return false;
  const bag = bagOf(player);
  if (bag[id]) return false;
  bag[id] = {
    name: def.name,
    description: def.description || '',
    progress: 0,
    target: def.target || 1,
    status: 'active',
  };
  save(player, bag);
  return true;
}

function advance(player, id, amount) {
  const step = amount == null ? 1 : amount;
  const bag = bagOf(player);
  const q = bag[id];
  if (!q || q.status === 'completed') return;
  q.progress = Math.min(q.target, q.progress + step);
  if (q.progress >= q.target) finish(player, id, bag);
  save(player, bag);
}

function complete(player, id) {
  const bag = bagOf(player);
  const q = bag[id];
  if (!q || q.status === 'completed') return;
  q.progress = q.target;
  finish(player, id, bag);
  save(player, bag);
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

log('Quest module ready.');
