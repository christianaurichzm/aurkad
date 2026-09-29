import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useId, type ReactNode } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useT } from '../../i18n';
import { Icon } from './Icon';

interface ModalProps {
  title: string;
  /** Without it a Modal is 520px wide; a floating window fits its content. */
  width?: number;
  onClose: () => void | Promise<void>;
  children: ReactNode;
  /**
   * A module's window: over the world without dimming it or holding the rest
   * of the page, and above any Modal. It still owns Escape and Tab while open.
   */
  floating?: boolean;
}

export const Modal = ({
  title,
  width,
  onClose,
  children,
  floating = false,
}: ModalProps) => {
  const t = useT();
  const titleId = useId();
  const w = width ?? (floating ? undefined : 520);
  const initialX = Math.max(12, window.innerWidth / 2 - (w ?? 240) / 2);
  const { ref, pos, onPointerDown } = useDraggable(
    initialX,
    window.innerHeight * 0.1,
  );
  useEscapeClose(true, onClose);

  useDialogFocus(titleId);

  return (
    <>
      {!floating && <div className="window-overlay" />}
      <div
        ref={ref}
        id={titleId}
        className={floating ? 'editor-window module-panel' : 'editor-window'}
        role="dialog"
        aria-modal={floating ? undefined : 'true'}
        aria-labelledby={`${titleId}-title`}
        tabIndex={-1}
        style={{ width: w, left: pos.x, top: pos.y }}
      >
        <div className="window-titlebar" onPointerDown={onPointerDown}>
          <h2 id={`${titleId}-title`}>{title}</h2>
          <button
            className="window-close"
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="window-content">{children}</div>
      </div>
    </>
  );
};

/** What a module renders as `engine.ui.Window`. */
export const ModuleWindow = (props: Omit<ModalProps, 'floating'>) => (
  <Modal {...props} floating />
);
