import { useEffect, useRef } from 'react';
import { useUIStore } from '../stores/uiStore';

// A listener here owns Escape while open, so the settings shortcut only
// opens on an empty screen. Claims stack; one Escape closes the newest.
const claims: Array<() => void | Promise<void>> = [];

export const escapeClaimed = () => claims.length > 0;

export function claimEscape(onClose: () => void | Promise<void>) {
  const close = () => onClose();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (claims.at(-1) !== close || useUIStore.getState().dialog.visible) return;
    event.preventDefault();
    void close();
  };
  claims.push(close);
  window.addEventListener('keydown', onKeyDown);
  return () => {
    const index = claims.indexOf(close);
    if (index !== -1) claims.splice(index, 1);
    window.removeEventListener('keydown', onKeyDown);
  };
}

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

    return claimEscape(() => onCloseRef.current());
  }, [active]);
};
