import { Key, Protocol } from '../../shared/types';
import { keyRecord } from '../../shared/mappings';
import {
  openContentEditor,
  openMapEditor,
  openModEditor,
  sendAction,
} from './network';
import { getAnimatedState } from '../graphics/movementAnimation';
import { getPlayer } from '../core/gameState';
import { isInputActive } from '../utils/domHelpers';

const isValidKey = (value: string): value is Key =>
  Object.values(Key).includes(value as Key);

const handleKeyPress = async (key: Key) => {
  switch (key) {
    case Key.x:
      if (await openModEditor()) {
        window.dispatchEvent(new Event('toggleGMPanel'));
      }
      break;
    case Key.z:
      if (await openMapEditor()) {
        window.dispatchEvent(new Event('toggleMapEditor'));
      }
      break;
    case Key.c:
      if (await openContentEditor()) {
        window.dispatchEvent(new Event('toggleContentEditor'));
      }
      break;
    case Key.i:
      window.dispatchEvent(new Event('toggleInventory'));
      break;
    case Key.o:
      window.dispatchEvent(new Event('toggleOnlinePlayers'));
      break;
    case Key.v:
      window.dispatchEvent(new Event('toggleAttributeDistributor'));
      break;
  }
};

let inputSeq = 0;
const heldKeys = new Set<Key>();

// A press of these keys mid-slide waits in a one-slot buffer and is sent on
// the first frame after the slide settles. Releasing first drops it.
const BUFFERABLE_KEYS: ReadonlySet<Key> = new Set([Key.Control]);
let bufferedPress: Key | null = null;

function isLocalPlayerMoving(): boolean {
  const player = getPlayer();
  if (!player) return false;
  return getAnimatedState(player.id, player.position).moving;
}

const sendPress = (key: Key) => {
  const seq = ++inputSeq;
  sendAction({ type: 'keyboard', keyboardAction: { key, type: 'press' }, seq });
};

export function flushInputBuffer(): void {
  if (!bufferedPress || isLocalPlayerMoving()) return;
  const key = bufferedPress;
  bufferedPress = null;
  sendPress(key);
}

// The one way in for every input device: the keyboard below, the on-screen
// pad and the gamepad. Hold semantics live here (the server keeps moving
// while a direction key is down), so a device only has to say pressed or
// released and inherits the dedupe, the slide buffer and the cooldown paint.
export const pressKey = async (key: Key): Promise<void> => {
  if (keyRecord[key] !== Protocol.WS) {
    await handleKeyPress(key);
    return;
  }
  if (heldKeys.has(key)) return;
  heldKeys.add(key);
  if (BUFFERABLE_KEYS.has(key) && isLocalPlayerMoving()) {
    bufferedPress = key;
    return;
  }
  sendPress(key);
};

export const releaseKey = (key: Key) => {
  if (!heldKeys.has(key)) return;
  heldKeys.delete(key);
  if (bufferedPress === key) {
    bufferedPress = null;
    return;
  }
  const seq = ++inputSeq;
  sendAction({
    type: 'keyboard',
    keyboardAction: { key, type: 'release' },
    seq,
  });
};

// Kept out of the listener because an async listener hands its rejection to
// the DOM, which drops it.
const onKeyDown = async (e: KeyboardEvent) => {
  if (e.defaultPrevented || isInputActive()) return;
  if (!document.hasFocus()) return;
  if (e.key in keyRecord) e.preventDefault();
  // OS auto-repeat is ignored: the server keeps moving while a key is held,
  // and repeats would trip the rate limit, which drops releases too.
  if (e.repeat) return;
  if (!isValidKey(e.key)) return;

  await pressKey(e.key);
};

export const handleInput = () => {
  window.addEventListener('keydown', (e) => {
    void onKeyDown(e);
  });

  window.addEventListener('keyup', (e) => {
    if (isValidKey(e.key)) releaseKey(e.key);
  });

  // Releasing a key while the window is unfocused (e.g. alt-tab) never fires
  // keyup, so release everything on blur to avoid a stuck key.
  window.addEventListener('blur', () => {
    for (const key of [...heldKeys]) releaseKey(key);
  });
};
