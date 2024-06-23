import { Key } from '../../shared/types';
import { getPlayer } from '../core/gameState';
import {
  initTilesetEditor,
  tilesetEditorInitialized,
  toggleTilesetEditor,
} from '../graphics/tileset';

export const keys: Record<Key, boolean> = {
  [Key.ArrowUp]: false,
  [Key.ArrowDown]: false,
  [Key.ArrowLeft]: false,
  [Key.ArrowRight]: false,
  [Key.Shift]: false,
  [Key.Control]: false,
  [Key.z]: false,
};

export const previousKeyState: Partial<Record<Key, boolean>> = {
  [Key.Shift]: false,
  [Key.Control]: false,
  [Key.z]: false,
};

export function handleInput() {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key in keys) {
      keys[e.key as Key] = true;
    }

    if (keys[Key.z] && !previousKeyState[Key.z]) {
      e.preventDefault();
      if (!getPlayer()) return;

      if (!tilesetEditorInitialized) {
        initTilesetEditor();
      }

      toggleTilesetEditor();
      previousKeyState[Key.z] = true;
    }
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.key in keys) {
      keys[e.key as Key] = false;
    }

    if (e.key === Key.z) {
      previousKeyState[Key.z] = false;
    }
  });
}
