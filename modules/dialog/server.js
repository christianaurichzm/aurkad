// @ts-check
// Dialog module: sends dialog:show, routes the client's dialog:choose back
// to the caller, and provides show() and start() through provide('dialog').
//
//   const dialog = use('dialog');
//   dialog.show(player, { text, choices: ['Yes', 'No'] }, (i) => { ... });
//
// An npc with a `dialogId` opens the conversation authored in the editor,
// whose `condition` and `action` on a choice name scripts.

const pending = new Map(); // playerName -> { id, choiceCount, onChoice }
let nextId = 1;

function show(player, options, onChoice) {
  const choices = (options && options.choices) || [];
  const id = nextId++;
  pending.set(player.name, {
    id,
    choiceCount: choices.length,
    onChoice: typeof onChoice === 'function' ? onChoice : () => {},
  });
  sendEvent(player, 'dialog:show', { id, text: options.text, choices });
}

// Untrusted client input: onChoice fires only if the id matches the
// player's open dialog and the index is in range.
on('customAction', ({ player, channel, payload }) => {
  if (channel !== 'dialog:choose') return;
  const open = pending.get(player.name);
  const data = /** @type {any} */ (payload);
  if (!open || !data || data.id !== open.id) return;

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

// A missing or throwing predicate counts as "no", so an unloaded script
// hides an option rather than offering a dead one.
function conditionAllows(choice, ctx) {
  if (!choice.condition) return true;
  const predicate = use('dialogCondition.' + choice.condition);
  if (typeof predicate !== 'function') {
    error('dialog choice names unregistered condition ' + choice.condition);
    return false;
  }
  try {
    return predicate(ctx) === true;
  } catch (e) {
    error('dialog condition threw: ' + e);
    return false;
  }
}

// Returns whether the conversation may continue. The next node assumes the
// action ran, so a failed action stops it.
function runAction(choice, ctx) {
  if (!choice.action) return true;
  const handler = use('dialogAction.' + choice.action);
  if (typeof handler !== 'function') {
    error('dialog choice names unregistered action ' + choice.action);
    return false;
  }
  try {
    handler(ctx);
    return true;
  } catch (e) {
    error('dialog action threw: ' + e);
    return false;
  }
}

function openNode(player, dialog, nodeId, npc) {
  const node = dialog.nodes.find((n) => n.id === nodeId);
  if (!node) {
    error('dialog ' + dialog.id + ' has no node ' + nodeId);
    return;
  }

  const base = { player, npc, dialog, node };
  // Filtered before the box is built, so a locked choice is absent and the
  // index the client sends back indexes this list.
  const choices = (node.choices || []).filter((c) => conditionAllows(c, base));

  show(
    player,
    { text: node.text, choices: choices.map((c) => c.label) },
    (index) => {
      // No choices means a single "Continue": nothing to run and nowhere to go.
      const choice = choices[index];
      if (!choice) return;
      if (!runAction(choice, Object.assign({ choice }, base))) return;
      if (choice.next) openNode(player, dialog, choice.next, npc);
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
  openNode(player, dialog, dialog.start || dialog.nodes[0].id, npc);
  return true;
}

on('npcInteract', ({ player, npc }) => {
  if (npc.dialogId) start(player, npc.dialogId, npc);
});

provide('dialog', { show, start });

log('Dialog module ready.');
