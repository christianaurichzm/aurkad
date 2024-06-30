import { Key, Protocol, keyRecord } from '../../shared/types';
import {
  initTilesetEditor,
  tilesetEditorInitialized,
  toggleTilesetEditor,
} from '../graphics/tileset';
import { openMapEditor, sendKeyboardAction } from './network';

const isValidKey = (value: string): value is Key => {
  return Object.values(Key).includes(value as Key);
};

export const handleInput = () => {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const { key } = event;

    if (isValidKey(key)) {
      if (keyRecord[key] === Protocol.WS) {
        sendKeyboardAction({ key, type: 'press' });
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
        }
      }
    }
  });

  window.addEventListener('keyup', (event: KeyboardEvent) => {
    const { key } = event;
    if (isValidKey(key)) {
      sendKeyboardAction({ key, type: 'release' });
    }
  });
};
