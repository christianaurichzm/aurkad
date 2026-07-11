// @ts-check
// Dialog module. Pure sandbox code over the script API: sends the dialog:show
// event, routes the client's dialog:choose back to the caller's onChoice, and
// exposes show() via provide('dialog'). The client DialogBox renders the box.
//
// Consume from a script or another module:
//   const dialog = use('dialog');
//   dialog.show(player, { text, choices: ['Yes', 'No'] }, (i) => { ... });

const pending = new Map(); // playerName -> { id, choiceCount, onChoice }
let nextId = 1;

function show(player, options, onChoice) {
  const choices = (options && options.choices) || [];
  const id = nextId++;
  pending.set(player.name, {
    id,
    choiceCount: choices.length,
    onChoice: typeof onChoice === "function" ? onChoice : () => {},
  });
  sendEvent(player, "dialog:show", { id, text: options.text, choices });
}

// Untrusted client input: onChoice fires only if the id matches the
// player's open dialog and the index is in range.
on("customAction", ({ player, channel, payload }) => {
  if (channel !== "dialog:choose") return;
  const open = pending.get(player.name);
  const data = /** @type {any} */ (payload);
  if (!open || !data || data.id !== open.id) return;

  const index = data.index;
  if (typeof index !== "number" || !Number.isInteger(index)) return;
  const max = open.choiceCount === 0 ? 0 : open.choiceCount - 1;
  if (index < 0 || index > max) return;

  pending.delete(player.name);
  try {
    open.onChoice(index);
  } catch (e) {
    error("dialog onChoice threw: " + e);
  }
});

provide("dialog", { show });

log("Dialog module ready.");
