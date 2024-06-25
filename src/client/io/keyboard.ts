import { Key } from '../../shared/types';
import { actionPlayer } from '../core/player';

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
    actionPlayer(e.key, 'keydown');
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    actionPlayer(e.key, 'keyup');
  });
}
