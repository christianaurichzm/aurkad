import {
  ClientKeyboardAction,
  Key,
  Protocol,
  keyRecord,
} from '../../shared/types';
import { toggleContentEditorMenu } from '../graphics/contentEditor';
import { toggleInventory } from '../graphics/inventory';
import { closeModMenu, toggleModMenu } from '../graphics/modMenu';
import {
  initTilesetEditor,
  tilesetEditorInitialized,
  toggleTilesetEditor,
} from '../graphics/tileset';
import {
  openContentEditor,
  openMapEditor,
  openModEditor,
  sendAction,
  sendChatMessage,
} from './network';

const isValidKey = (value: string): value is Key =>
  Object.values(Key).includes(value as Key);

const isInputActive = (): boolean => {
  const active = document.activeElement;
  return !!active && (active.id === 'chatInput' || active.tagName === 'INPUT');
};

const handleKeyPress = async (key: Key) => {
  switch (key) {
    case Key.x:
      if (await openModEditor()) {
        toggleModMenu();
      }
      break;
    case Key.z:
      if (await openMapEditor()) {
        if (!tilesetEditorInitialized) {
          initTilesetEditor();
        }
        toggleTilesetEditor();
        closeModMenu();
      }
      break;
    case Key.c:
      if (await openContentEditor()) {
        toggleContentEditorMenu();
      }
      break;
    case Key.i:
      toggleInventory();
      break;
    default:
      break;
  }
};

export const handleInput = () => {
  window.addEventListener('keydown', async (event: KeyboardEvent) => {
    const { key } = event;

    if (isInputActive()) return;

    if (key in keyRecord) {
      event.preventDefault();
    }

    if (isValidKey(key)) {
      if (keyRecord[key] === Protocol.WS) {
        sendAction({
          keyboardAction: { key, type: 'press' },
          type: 'keyboard',
        } as ClientKeyboardAction);
      } else {
        await handleKeyPress(key);
      }
    }
  });

  window.addEventListener('keyup', (event: KeyboardEvent) => {
    const { key } = event;
    if (isValidKey(key)) {
      sendAction({
        keyboardAction: { key, type: 'release' },
        type: 'keyboard',
      } as ClientKeyboardAction);
    }
  });
};

document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});
