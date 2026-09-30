import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useEffect, useId, type ReactNode } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useT } from '../../i18n';
import { Icon } from './Icon';

/** The three widths of a window the player uses; nothing in between. */
export type WindowSize = 'narrow' | 'regular' | 'wide';
const SIZES: Record<WindowSize, number> = {
  narrow: 280,
  regular: 380,
  wide: 560,
};

// Floating windows take the next number when they open and when they are
// pressed, so the one being used is on top whichever was opened first.
let front = 1002;

interface ModalProps {
  title: string;
  /** Without it a Modal is 520px wide; a floating window fits its content. */
  width?: number;
  /**
   * For a window the player uses, in place of a width of its own: it also
   * takes the player's window look, larger type and a bar built to be read.
   */
  size?: WindowSize;
  /**
   * Which side of the world a sized window opens on; the middle is where the
   * character stands.
   */
  anchor?: 'left' | 'right';
  /** A name of the window's own, for a theme to find it by. */
  className?: string;
  /** Set beside the title, for what the window holds ("14/24"). */
  counter?: string;
  /** Under the body and out of its scroll: the window's actions. */
  footer?: ReactNode;
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
  size,
  anchor = 'left',
  className,
  counter,
  footer,
  onClose,
  children,
  floating = false,
}: ModalProps) => {
  const t = useT();
  const titleId = useId();
  const w = size ? SIZES[size] : (width ?? (floating ? undefined : 520));
  const world = size && document.getElementById('canvasFrame');
  const { ref, pos, onPointerDown } = useDraggable(
    ...(world
      ? besideTheWorld(world.getBoundingClientRect(), SIZES[size], anchor)
      : ([
          Math.max(12, window.innerWidth / 2 - (w ?? 240) / 2),
          window.innerHeight * 0.1,
        ] as const)),
  );
  useEscapeClose(true, onClose);

  useDialogFocus(titleId);

  useEffect(() => {
    if (floating) raise(document.getElementById(titleId));
  }, [floating, titleId]);

  return (
    <>
      {!floating && <div className="window-overlay" />}
      <div
        ref={ref}
        id={titleId}
        className={[
          'editor-window',
          floating && 'module-panel',
          size && 'game-window',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal={floating ? undefined : 'true'}
        aria-labelledby={`${titleId}-title`}
        tabIndex={-1}
        style={{ width: w, left: pos.x, top: pos.y }}
        onPointerDownCapture={
          floating ? (e) => raise(e.currentTarget) : undefined
        }
      >
        <div className="window-titlebar" onPointerDown={onPointerDown}>
          <h2 id={`${titleId}-title`}>{title}</h2>
          {counter && <span className="window-counter">{counter}</span>}
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
        {footer && <div className="window-footer">{footer}</div>}
      </div>
    </>
  );
};

// Under the map's name and a step in from the frame. useDraggable pulls it
// back in when the world is narrower than the window.
const besideTheWorld = (world: DOMRect, width: number, anchor: string) =>
  [
    anchor === 'right' ? world.right - width - 12 : world.left + 12,
    world.top + 44,
  ] as const;

function raise(window: HTMLElement | null) {
  if (window) window.style.zIndex = String(++front);
}

/** What a module renders as `engine.ui.Window`. */
export const ModuleWindow = ({
  width,
  ...props
}: Omit<ModalProps, 'floating' | 'size' | 'width'> & {
  width?: number | WindowSize;
}) =>
  typeof width === 'string' ? (
    <Modal {...props} size={width} floating />
  ) : (
    <Modal {...props} width={width} floating />
  );
