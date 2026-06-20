import React, { useEffect } from 'react';
import { colors, radius, shadow, zIndex } from '../../theme';
import { useUIStore } from '../../stores/uiStore';

export const DialogHost: React.FC = () => {
  const dialog = useUIStore((state) => state.dialog);
  const closeDialog = useUIStore((state) => state.closeDialog);

  useEffect(() => {
    if (!dialog.visible) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDialog(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDialog, dialog.visible]);

  if (!dialog.visible) return null;

  const isConfirm = dialog.kind === 'confirm';
  const accent =
    dialog.kind === 'error'
      ? colors.danger
      : dialog.kind === 'confirm'
        ? colors.warning
        : colors.primary;

  return (
    <div style={styles.overlay}>
      <section
        aria-modal="true"
        role="dialog"
        aria-labelledby="ui-dialog-title"
        style={{ ...styles.dialog, borderTopColor: accent }}
      >
        <h2 id="ui-dialog-title" style={styles.title}>
          {dialog.title}
        </h2>
        <p style={styles.message}>{dialog.message}</p>
        <div style={styles.actions}>
          {isConfirm && (
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => closeDialog(false)}
            >
              {dialog.cancelLabel}
            </button>
          )}
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              backgroundColor:
                dialog.kind === 'error' ? colors.danger : colors.primary,
            }}
            onClick={() => closeDialog(true)}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: zIndex.modalOverlay,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.overlay,
    padding: 16,
  },
  dialog: {
    width: 'min(420px, 100%)',
    background: colors.surface,
    color: colors.text,
    borderRadius: radius.lg,
    borderTop: `4px solid ${colors.primary}`,
    boxShadow: shadow.modal,
    padding: 20,
    zIndex: zIndex.modal,
  },
  title: {
    margin: 0,
    fontSize: 20,
    lineHeight: 1.2,
  },
  message: {
    margin: '12px 0 0',
    color: colors.textMuted,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap' as const,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  primaryButton: {
    border: 'none',
    borderRadius: radius.md,
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 700,
    padding: '9px 14px',
  },
  secondaryButton: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    background: colors.surfaceMuted,
    color: colors.text,
    cursor: 'pointer',
    fontWeight: 600,
    padding: '9px 14px',
  },
};
