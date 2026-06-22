import { PlayerServer } from '../../shared/types.js';
import { on } from '../engine/hooks.js';
import { sendCustomEvent } from './customEventService.js';
import { logger } from '../logger.js';

// Dialog system built on the custom-event pipe. The engine ships the box
// (client UI on the `dialog:show` channel) and this routing; games supply
// the content and flow. showDialog sends a box and routes the player's
// choice back to the callback, so scripts never touch raw net events.

export interface DialogOptions {
  text: string;
  choices?: string[];
}

type ChoiceHandler = (choiceIndex: number) => void;

interface PendingDialog {
  id: number;
  choiceCount: number;
  onChoice: ChoiceHandler;
}

const pending = new Map<string, PendingDialog>();
let nextId = 1;

export function showDialog(
  player: PlayerServer,
  options: DialogOptions,
  onChoice: ChoiceHandler = () => {},
): void {
  const choices = options.choices ?? [];
  const id = nextId++;
  pending.set(player.name, { id, choiceCount: choices.length, onChoice });
  sendCustomEvent(player, 'dialog:show', { id, text: options.text, choices });
}

// Routed from the dialog:choose custom action. Payload is untrusted client
// input: only fire the callback if the id matches this player's open dialog and
// the index is in range.
export function handleDialogChoice(player: PlayerServer, payload: unknown): void {
  const open = pending.get(player.name);
  if (!open) return;

  const data = payload as { id?: unknown; index?: unknown } | null;
  if (!data || data.id !== open.id) return;

  const index = data.index;
  if (typeof index !== 'number' || !Number.isInteger(index)) return;
  // A choiceless dialog ("Continue") accepts index 0; otherwise bound-check.
  const max = open.choiceCount === 0 ? 0 : open.choiceCount - 1;
  if (index < 0 || index > max) return;

  pending.delete(player.name);
  try {
    open.onChoice(index);
  } catch (e) {
    logger.error('[dialog] onChoice handler threw', { err: e });
  }
}

export function registerDialogHandlers(): void {
  on('customAction', ({ player, channel, payload }) => {
    if (channel === 'dialog:choose') handleDialogChoice(player, payload);
  });
}

// Test helper.
export function clearDialogs(): void {
  pending.clear();
  nextId = 1;
}
