import { ClientKeyboardAction, Key, Protocol } from '../../shared/types';
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

export const handleInput = () => {
  window.addEventListener('keydown', async (e) => {
    if (isInputActive()) return;
    if (e.key in keyRecord) e.preventDefault();
    if (isValidKey(e.key)) {
      if (keyRecord[e.key] === Protocol.WS) {
        sendAction({
          keyboardAction: { key: e.key, type: 'press' },
          type: 'keyboard',
        } as ClientKeyboardAction);
      } else {
        await handleKeyPress(e.key);
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (isValidKey(e.key)) {
      sendAction({
        keyboardAction: { key: e.key, type: 'release' },
        type: 'keyboard',
      } as ClientKeyboardAction);
    }
  });
};
