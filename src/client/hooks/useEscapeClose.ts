import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

export const useEscapeClose = (
  active: boolean,
  onClose: () => void | Promise<void>,
) => {
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (useUIStore.getState().dialog.visible) return;

      event.preventDefault();
      void onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onClose]);
};
