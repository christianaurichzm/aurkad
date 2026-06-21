import { Key, Protocol } from '../../shared/types';
import { keyRecord } from '../../shared/mappings';
import {
  openContentEditor,
  openMapEditor,
  openModEditor,
  sendAction,
} from './network';

const isValidKey = (value: string): value is Key =>
  Object.values(Key).includes(value as Key);

const isInputActive = (): boolean => {
  const a = document.activeElement;
  return !!a && (a.id === 'chatInput' || a.tagName === 'INPUT');
};

const handleKeyPress = async (key: Key) => {
  switch (key) {
    case Key.x:
      if (await openModEditor()) {
        window.dispatchEvent(new Event('toggleModMenu'));
      }
      break;
    case Key.z:
      if (await openMapEditor()) {
        window.dispatchEvent(new Event('toggleTilesetEditor'));
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
    case Key.v:
      window.dispatchEvent(new Event('toggleAttributeDistributor'));
      break;
  }
};

let inputSeq = 0;
const heldKeys = new Set<Key>();

const releaseKey = (key: Key) => {
  if (!heldKeys.has(key)) return;
  heldKeys.delete(key);
  const seq = ++inputSeq;
  sendAction({
    type: 'keyboard',
    keyboardAction: { key, type: 'release' },
    seq,
  });
};

export const handleInput = () => {
  window.addEventListener('keydown', async (e) => {
    if (isInputActive()) return;
    if (!document.hasFocus()) return;
    if (e.key in keyRecord) e.preventDefault();
    // OS auto-repeat is ignored: the server keeps moving while a key is held,
    // and repeats would trip the rate limit, which drops releases too.
    if (e.repeat) return;
    if (!isValidKey(e.key)) return;

    if (keyRecord[e.key] === Protocol.WS) {
      if (heldKeys.has(e.key)) return;
      heldKeys.add(e.key);
      const seq = ++inputSeq;
      sendAction({
        type: 'keyboard',
        keyboardAction: { key: e.key, type: 'press' },
        seq,
      });
    } else {
      await handleKeyPress(e.key);
    }
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
