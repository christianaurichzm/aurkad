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

/** Each device holding a key down, so one letting go is not all of them. */
export type KeySource = 'keyboard' | 'gamepad' | 'touch' | 'pointer';
const holders = new Map<Key, Set<KeySource>>();

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

// The one way in for every input: keyboard, on-screen pad, pointer taps and
// gamepad. Hold semantics live here, so a device only says pressed or
// released and gets the dedupe, slide buffer and cooldown paint. The server
// hears the first device to press a key and the last to let it go.
export const pressKey = async (key: Key, source: KeySource): Promise<void> => {
  if (keyRecord[key] !== Protocol.WS) {
    await handleKeyPress(key);
    return;
  }
  const by = holders.get(key);
  if (by) {
    by.add(source);
    return;
  }
  holders.set(key, new Set([source]));
  if (BUFFERABLE_KEYS.has(key) && isLocalPlayerMoving()) {
    bufferedPress = key;
    return;
  }
  sendPress(key);
};

export const releaseKey = (key: Key, source: KeySource) => {
  const by = holders.get(key);
  if (!by?.delete(source) || by.size > 0) return;
  holders.delete(key);
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

  await pressKey(e.key, 'keyboard');
};

export const handleInput = () => {
  window.addEventListener('keydown', (e) => {
    void onKeyDown(e);
  });

  window.addEventListener('keyup', (e) => {
    if (isValidKey(e.key)) releaseKey(e.key, 'keyboard');
  });

  // A key released while the window is unfocused fires no keyup, so blur
  // lets go of every keyboard key. The gamepad says each frame what it holds.
  window.addEventListener('blur', () => {
    for (const key of [...holders.keys()]) releaseKey(key, 'keyboard');
  });

  // A new socket, after a reconnect or a warp to another instance, starts
  // with no keys down while the hand still holds them, and the browser sends
  // no new keydown. A press made while the socket was closed was lost too.
  window.addEventListener('socketOpen', () => {
    for (const key of holders.keys()) if (key !== bufferedPress) sendPress(key);
  });
};
