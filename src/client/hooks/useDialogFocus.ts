import { useEffect } from 'react';

export function focusDialog(dialog: HTMLElement) {
  const previous = document.activeElement as HTMLElement | null;
  dialog.focus();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
      ),
    ).filter(
      (element) => element.tabIndex >= 0 && element.getClientRects().length > 0,
    );
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  dialog.addEventListener('keydown', onKeyDown);
  return () => {
    dialog.removeEventListener('keydown', onKeyDown);
    if (previous?.isConnected) previous.focus();
  };
}

export function useDialogFocus(id: string, visible = true) {
  useEffect(() => {
    if (!visible) return;
    const dialog = document.getElementById(id);
    if (dialog) return focusDialog(dialog);
  }, [id, visible]);
}
