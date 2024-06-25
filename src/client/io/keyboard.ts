import { Key } from '../../shared/types';
import { sendKeyboardAction } from './network';

const isValidKey = (value: string): value is Key => {
  return Object.values(Key).includes(value as Key);
};

export const handleInput = () => {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const { key } = event;
    if (isValidKey(key)) {
      sendKeyboardAction({ key, type: 'press' });
    }
  });

  window.addEventListener('keyup', (event: KeyboardEvent) => {
    const { key } = event;
    if (isValidKey(key)) {
      sendKeyboardAction({ key, type: 'release' });
    }
  });
};
