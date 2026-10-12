// @ts-check
// Dialog module: sends dialog:show, routes the client's dialog:choose back
// to the caller, and provides show() and start() through provide('dialog').
//
//   const dialog = use('dialog');
//   dialog.show(player, { text, choices: ['Yes', 'No'] }, (i) => { ... });
//
// A player may close a box without answering, and onChoice then never runs.
// An npc with a `dialogId` opens the conversation authored in the editor,
// whose `condition` and `action` on a choice name scripts.

const pending = new Map(); // playerName -> { id, choiceCount, onChoice }
let nextId = 1;

function show(player, options, onChoice) {
  const choices = (options && options.choices) || [];
  const npc = options && options.npc;
  const id = nextId++;
  pending.set(player.name, {
    id,
    choiceCount: choices.length,
    onChoice: typeof onChoice === 'function' ? onChoice : () => {},
  });
  sendEvent(player, 'dialog:show', {
    id,
    speaker: options.speaker || (npc ? npc.name : undefined),
    text: options.text,
    choices,
    // Who is talking, for the box to draw a portrait from and the world to
    // light up behind it.
    sprite: npc ? npc.sprite : undefined,
    npcId: npc ? npc.id : undefined,
    read: options.read,
  });
}

// Untrusted client input: onChoice fires only if the id matches the
// player's open dialog and the index is in range.
on('customAction', ({ player, channel, payload }) => {
  if (channel !== 'dialog:choose' && channel !== 'dialog:close') return;
  const open = pending.get(player.name);
  const data = /** @type {any} */ (payload);
  if (!open || !data || data.id !== open.id) return;

  if (channel === 'dialog:close') {
    pending.delete(player.name);
    return;
  }

  const index = data.index;
  if (typeof index !== 'number' || !Number.isInteger(index)) return;
  const max = open.choiceCount === 0 ? 0 : open.choiceCount - 1;
  if (index < 0 || index > max) return;

  pending.delete(player.name);
  try {
    open.onChoice(index);
  } catch (e) {
    error('dialog onChoice threw: ' + e);
  }
});

// A box belongs to the session that opened it, so it is dropped on leave
// and a late choice cannot land on a stale player.
on('playerLeave', ({ player }) => {
  pending.delete(player.name);
});
on('playerJoin', ({ player }) => {
  sendEvent(player, 'dialog:hide', {});
});

// `name` or `name:arg`, split on the first colon, so one handler like
// `questStart:goblinHunt` serves every quest.
function splitRef(ref) {
  const at = ref.indexOf(':');
  if (at === -1) return { name: ref, arg: undefined };
  return { name: ref.slice(0, at), arg: ref.slice(at + 1) };
}

// A missing or throwing predicate counts as "no", so an unloaded script
// hides an option rather than offering a dead one.
function conditionAllows(choice, ctx) {
  if (!choice.condition) return true;
  const { name, arg } = splitRef(choice.condition);
  const predicate = use('dialogCondition.' + name);
  if (typeof predicate !== 'function') {
    error('dialog choice names unregistered condition ' + name);
    return false;
  }
  try {
    return predicate(Object.assign({ arg }, ctx)) === true;
  } catch (e) {
    error('dialog condition threw: ' + e);
    return false;
  }
}

// Returns whether the conversation may continue. The next node assumes the
// action ran, so a failed action stops it.
function runAction(choice, ctx) {
  if (!choice.action) return true;
  const { name, arg } = splitRef(choice.action);
  const handler = use('dialogAction.' + name);
  if (typeof handler !== 'function') {
    error('dialog choice names unregistered action ' + name);
    return false;
  }
  try {
    handler(Object.assign({ arg }, ctx));
    return true;
  } catch (e) {
    error('dialog action threw: ' + e);
    return false;
  }
}

// `seen` is the nodes this conversation has been through, so the box can mark
// a choice that leads back to something already said.
function openNode(player, dialog, nodeId, npc, seen) {
  const node = dialog.nodes.find((n) => n.id === nodeId);
  if (!node) {
    error('dialog ' + dialog.id + ' has no node ' + nodeId);
    return;
  }
  seen.add(nodeId);

  const base = { player, npc, dialog, node };
  // Filtered before the box is built, so a locked choice is absent and the
  // index the client sends back indexes this list.
  const choices = (node.choices || []).filter((c) => conditionAllows(c, base));

  show(
    player,
    {
      speaker: npc?.name || dialog.name,
      npc,
      text: node.text,
      choices: choices.map((c) => c.label),
      read: choices.flatMap((c, i) => (c.next && seen.has(c.next) ? [i] : [])),
    },
    (index) => {
      // No choices means a single "Continue": nothing to run and nowhere to go.
      const choice = choices[index];
      if (!choice) return;
      if (!runAction(choice, Object.assign({ choice }, base))) return;
      if (choice.next) openNode(player, dialog, choice.next, npc, seen);
    },
  );
}

// Opens an authored conversation. `npc` is optional: a tile trigger or a script
// can start one with nobody to talk to.
function start(player, dialogId, npc) {
  const dialog = getDialog(dialogId);
  if (!dialog || dialog.nodes.length === 0) {
    error('dialog ' + dialogId + ' is missing or empty');
    return false;
  }
  openNode(player, dialog, dialog.start || dialog.nodes[0].id, npc, new Set());
  return true;
}

on('npcInteract', ({ player, npc }) => {
  if (npc.dialogId) start(player, npc.dialogId, npc);
});

provide('dialog', { show, start });

log('Dialog module ready.');
