import React, { ReactNode } from 'react';
import { useDraggable } from '../../hooks/useDraggable';

interface ModalProps {
  title: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  title,
  width = 520,
  onClose,
  children,
}) => {
  const initialX = window.innerWidth / 2 - width / 2;
  const initialY = window.innerHeight * 0.15;

  const { ref, pos, onMouseDown } = useDraggable(initialX, initialY);

  const styles = {
    overlay: {
      position: 'fixed' as const,
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0)',
      zIndex: 1000,
    },
    container: {
      position: 'fixed' as const,
      backgroundColor: '#fff',
      border: '1px solid #ccc',
      borderRadius: 12,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      zIndex: 1001,
      display: 'flex',
      flexDirection: 'column' as const,
      maxHeight: '80vh',
      overflowY: 'auto' as const,
      width,
      left: pos.x,
      top: pos.y,
    },
    titlebar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
      position: 'relative' as const,
      borderBottom: '1px solid #ddd',
      cursor: 'move',
      userSelect: 'none' as const,
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
      backgroundColor: '#eee',
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
        <div style={styles.titlebar} onMouseDown={onMouseDown}>
          <h2 style={styles.title}>{title}</h2>
          <button
            style={styles.closeButton}
            onClick={onClose}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = '#ddd')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = '#eee')
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
