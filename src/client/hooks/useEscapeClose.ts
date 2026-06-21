import { useEffect, useRef } from 'react';
import { useUIStore } from '../stores/uiStore';

export const useEscapeClose = (
  active: boolean,
  onClose: () => void | Promise<void>,
) => {
  // Keep the latest callback in a ref so callers can pass an inline onClose
  // without the listener re-subscribing on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (useUIStore.getState().dialog.visible) return;

      event.preventDefault();
      void onCloseRef.current();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
};
