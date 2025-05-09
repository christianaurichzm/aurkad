import {
  ClientKeyboardAction,
  Key,
  Protocol,
  keyRecord,
} from '../../shared/types';
import { toggleInventory } from '../graphics/inventory';
import {
  initTilesetEditor,
  tilesetEditorInitialized,
  toggleTilesetEditor,
} from '../graphics/tileset';
import { openMapEditor, sendAction } from './network';

const isValidKey = (value: string): value is Key => {
  return Object.values(Key).includes(value as Key);
};

export const handleInput = () => {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const { key } = event;

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
        if (key === Key.z) {
          openMapEditor().then((res) => {
            if (res) {
              if (!tilesetEditorInitialized) {
                initTilesetEditor();
              }
              toggleTilesetEditor();
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
