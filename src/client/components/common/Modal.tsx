import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useId, type ReactNode } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useT } from '../../i18n';

interface ModalProps {
  title: string;
  width?: number;
  onClose: () => void | Promise<void>;
  children: ReactNode;
}

export const Modal = ({
  title,
  width = 520,
  onClose,
  children,
}: ModalProps) => {
  const t = useT();
  const titleId = useId();
  const initialX = Math.max(12, window.innerWidth / 2 - width / 2);
  const { ref, pos, onPointerDown } = useDraggable(
    initialX,
    window.innerHeight * 0.1,
  );
  useEscapeClose(true, onClose);

  useDialogFocus(titleId);

  return (
    <>
      <div className="window-overlay" />
      <div
        ref={ref}
        id={titleId}
        className="editor-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${titleId}-title`}
        tabIndex={-1}
        style={{ width, left: pos.x, top: pos.y }}
      >
        <div className="window-titlebar" onPointerDown={onPointerDown}>
          <h2 id={`${titleId}-title`}>{title}</h2>
          <button
            className="window-close"
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="window-content">{children}</div>
      </div>
    </>
  );
};
