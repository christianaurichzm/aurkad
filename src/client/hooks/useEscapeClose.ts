import { useEffect, useRef } from 'react';
import { useUIStore } from '../stores/uiStore';

// Anything listening here owns Escape while it is open. The settings shortcut
// asks this before claiming the key, so it opens on an empty screen and not on
// the Escape that just closed a panel.
let claims = 0;

export const escapeClaimed = () => claims > 0;

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

    claims += 1;
    window.addEventListener('keydown', onKeyDown);
    return () => {
      claims -= 1;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active]);
};
