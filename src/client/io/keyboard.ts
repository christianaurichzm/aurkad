import { Key } from '../../shared/types';

export const keys: Record<Key, boolean> = {
  [Key.ArrowUp]: false,
  [Key.ArrowDown]: false,
  [Key.ArrowLeft]: false,
  [Key.ArrowRight]: false,
  [Key.Shift]: false,
  [Key.Control]: false,
};

export const previousKeyState: Partial<Record<Key, boolean>> = {
  [Key.Shift]: false,
  [Key.Control]: false,
};

export function handleInput() {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    keys[e.key as Key] = true;
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keys[e.key as Key] = false;
  });
}
