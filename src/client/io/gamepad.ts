import { Key } from '../../shared/types';
import { pressKey, releaseKey } from './keyboard';
import { isInputActive } from '../utils/domHelpers';

// A gamepad reports state, not events, so each frame's pad is turned into
// the same held-key set the keyboard makes, and the change from the last
// frame becomes presses and releases.
//
// Only the standard mapping is read: face buttons 0-3, shoulders 4-5, d-pad
// 12-15, left stick on axes 0-1. A pad with another mapping keeps its
// indices, as in every browser game.
const BUTTON_KEYS: Record<number, Key> = {
  0: Key.Control, // A - attack
  1: Key.e, // B - pick up
  2: Key.f, // X - interact
  3: Key.i, // Y - inventory
  4: Key.Shift, // LB - run
  5: Key.Shift, // RB - run
  12: Key.ArrowUp,
  13: Key.ArrowDown,
  14: Key.ArrowLeft,
  15: Key.ArrowRight,
};

// Past a worn stick's drift, below a real push. Movement is per tile, so a
// half push means nothing.
const DEAD_ZONE = 0.5;

let held: Set<Key> = new Set();

const readPad = (pad: Gamepad): Set<Key> => {
  const keys = new Set<Key>();

  pad.buttons.forEach((button, index) => {
    const key = BUTTON_KEYS[index];
    if (key && button.pressed) keys.add(key);
  });

  const [x = 0, y = 0] = pad.axes;
  if (y < -DEAD_ZONE) keys.add(Key.ArrowUp);
  else if (y > DEAD_ZONE) keys.add(Key.ArrowDown);
  if (x < -DEAD_ZONE) keys.add(Key.ArrowLeft);
  else if (x > DEAD_ZONE) keys.add(Key.ArrowRight);

  return keys;
};

/**
 * Called once per frame. Cheap with no pad: the browser returns nulls until
 * a pad reports itself, which it does only after a button press.
 */
export const pollGamepad = (): void => {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = pads.find((candidate) => candidate?.connected);

  // As with the keyboard, typing in a field or another window in front reads
  // as nothing held, so a held direction stops and resumes with the focus.
  const playing = document.hasFocus() && !isInputActive();
  const next = pad && playing ? readPad(pad) : new Set<Key>();

  for (const key of held) if (!next.has(key)) releaseKey(key, 'gamepad');
  for (const key of next) if (!held.has(key)) void pressKey(key, 'gamepad');

  held = next;
};
