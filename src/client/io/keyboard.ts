import { Key } from '../../shared/types';

export const keys: { [key: string]: boolean } = {};

export const previousKeyState: Partial<Record<Key, boolean>> = {
  [Key.Shift]: false,
  [Key.Control]: false,
};

export function handleInput() {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    keys[e.key] = true;
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keys[e.key] = false;
  });
}
