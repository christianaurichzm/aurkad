import {
  ClientKeyboardAction,
  Key,
  Protocol,
  keyRecord,
} from '../../shared/types';
import { toggleContentEditorMenu } from '../graphics/contentEditor';
import { toggleInventory } from '../graphics/inventory';
import { closeModMenu, toggleModMenu } from '../graphics/mod';
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

const isValidKey = (value: string): value is Key => {
  return Object.values(Key).includes(value as Key);
};

export const handleInput = () => {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const { key } = event;

    const active = document.activeElement;
    if (active && (active.id === 'chatInput' || active.tagName === 'INPUT')) {
      return;
    }

    if (Object.keys(keyRecord).includes(key)) {
      event.preventDefault();
    }

    if (isValidKey(key)) {
      if (keyRecord[key] === Protocol.WS) {
        sendAction({
          keyboardAction: { key, type: 'press' },
          type: 'keyboard',
        } as ClientKeyboardAction);
      } else {
        if (key === Key.x) {
          openModEditor().then((res) => {
            if (res) {
              toggleModMenu();
            }
          });
        } else if (key === Key.z) {
          openMapEditor().then((res) => {
            if (res) {
              if (!tilesetEditorInitialized) {
                initTilesetEditor();
              }
              toggleTilesetEditor();
              closeModMenu();
            }
          });
        } else if (key === Key.c) {
          openContentEditor().then((res) => {
            if (res) {
              toggleContentEditorMenu();
            }
          });
        } else if (key === Key.i) {
          toggleInventory();
        }
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
