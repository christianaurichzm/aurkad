import React, { ReactNode } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { colors, radius, shadow, zIndex } from '../../theme';

interface ModalProps {
  title: string;
  width?: number;
  onClose: () => void | Promise<void>;
  children: ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  title,
  width = 520,
  onClose,
  children,
}) => {
  const initialX = Math.max(12, window.innerWidth / 2 - width / 2);
  const initialY = window.innerHeight * 0.15;

  const { ref, pos, onPointerDown } = useDraggable(initialX, initialY);
  useEscapeClose(true, onClose);

  const styles = {
    overlay: {
      position: 'fixed' as const,
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0)',
      zIndex: zIndex.modalOverlay,
    },
    container: {
      position: 'fixed' as const,
      backgroundColor: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: radius.lg,
      boxShadow: shadow.modal,
      zIndex: zIndex.modal,
      display: 'flex',
      flexDirection: 'column' as const,
      maxHeight: '80vh',
      overflowY: 'auto' as const,
      width,
      maxWidth: 'calc(100vw - 24px)',
      left: pos.x,
      top: pos.y,
    },
    titlebar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
      position: 'relative' as const,
      borderBottom: `1px solid ${colors.border}`,
      cursor: 'move',
      userSelect: 'none' as const,
      // Without this the browser takes the gesture for a scroll and
      // cancels the pointer mid-drag, and a finger drags the page rather
      // than the panel.
      touchAction: 'none' as const,
    },
    title: {
      fontSize: 18,
      fontWeight: 'bold',
      margin: 0,
    },
    closeButton: {
      position: 'absolute' as const,
      top: '50%',
      right: 12,
      transform: 'translateY(-50%)',
      width: 24,
      height: 24,
      backgroundColor: colors.surfaceMuted,
      border: 'none',
      borderRadius: '50%',
      fontWeight: 'bold' as const,
      fontSize: 16,
      cursor: 'pointer',
      lineHeight: 1,
      textAlign: 'center' as const,
      padding: 0,
    },
    content: {
      padding: 16,
    },
  };

  return (
    <>
      <div style={styles.overlay} />
      <div ref={ref} style={styles.container}>
        <div style={styles.titlebar} onPointerDown={onPointerDown}>
          <h2 style={styles.title}>{title}</h2>
          <button
            style={styles.closeButton}
            onClick={onClose}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = colors.border)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = colors.surfaceMuted)
            }
          >
            x
          </button>
        </div>
        <div style={styles.content}>{children}</div>
      </div>
    </>
  );
};
