import React, { useEffect, useRef, useState } from 'react';
import { Key } from '../../../shared/types';
import { pressKey, releaseKey } from '../../io/keyboard';
import { useT } from '../../i18n';

// Pointer capture keeps the held direction alive as the thumb crosses buttons.
// Movement still enters through the same discrete keys as keyboard/gamepad.
const hold = (key: Key) => ({
  onPointerDown: (event: React.PointerEvent) => {
    // Stops the tap turning into focus, a synthesized mouse event and, on a
    // double tap, a zoom.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void pressKey(key);
  },
  onPointerUp: () => releaseKey(key),
  onPointerCancel: () => releaseKey(key),
  onLostPointerCapture: () => releaseKey(key),
  onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
});

export const TouchControls: React.FC = () => {
  const t = useT();
  const gesture = useRef<{ pointerId: number; key: Key | null } | null>(null);
  const [direction, setDirection] = useState<Key | null>(null);

  const changeDirection = (key: Key | null) => {
    const current = gesture.current;
    if (!current || current.key === key) return;
    if (current.key) releaseKey(current.key);
    current.key = key;
    if (key) void pressKey(key);
    setDirection(key);
  };

  const endGesture = (event: React.PointerEvent) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    changeDirection(null);
    gesture.current = null;
  };

  useEffect(() => {
    const release = () => {
      if (gesture.current?.key) releaseKey(gesture.current.key);
      gesture.current = null;
      setDirection(null);
    };
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('blur', release);
      if (gesture.current?.key) releaseKey(gesture.current.key);
    };
  }, []);

  return (
    <div id="touchControls" aria-label={t('touch.controls')} role="group">
      <div
        className="touch-dpad"
        onPointerDown={(event) => {
          if (gesture.current || event.button > 0) return;
          const button = (
            event.target as HTMLElement
          ).closest<HTMLButtonElement>('button[data-direction]');
          if (!button) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { pointerId: event.pointerId, key: null };
          changeDirection(button.dataset.direction as Key);
        }}
        onPointerMove={(event) => {
          if (gesture.current?.pointerId !== event.pointerId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left - rect.width / 2;
          const y = event.clientY - rect.top - rect.height / 2;
          const inCenter =
            Math.abs(x) < rect.width / 6 && Math.abs(y) < rect.height / 6;
          changeDirection(
            inCenter
              ? null
              : Math.abs(x) > Math.abs(y)
                ? x < 0
                  ? Key.ArrowLeft
                  : Key.ArrowRight
                : y < 0
                  ? Key.ArrowUp
                  : Key.ArrowDown,
          );
        }}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button
          type="button"
          className="touch-button touch-up"
          aria-label={t('touch.up')}
          data-direction={Key.ArrowUp}
          aria-pressed={direction === Key.ArrowUp}
        >
          ▲
        </button>
        <button
          type="button"
          className="touch-button touch-left"
          aria-label={t('touch.left')}
          data-direction={Key.ArrowLeft}
          aria-pressed={direction === Key.ArrowLeft}
        >
          ◀
        </button>
        <button
          type="button"
          className="touch-button touch-right"
          aria-label={t('touch.right')}
          data-direction={Key.ArrowRight}
          aria-pressed={direction === Key.ArrowRight}
        >
          ▶
        </button>
        <button
          type="button"
          className="touch-button touch-down"
          aria-label={t('touch.down')}
          data-direction={Key.ArrowDown}
          aria-pressed={direction === Key.ArrowDown}
        >
          ▼
        </button>
      </div>
      <div className="touch-actions">
        <button
          type="button"
          className="touch-button touch-attack"
          aria-label={t('touch.attack')}
          {...hold(Key.Control)}
        >
          ⚔
        </button>
        <button
          type="button"
          className="touch-button"
          aria-label={t('touch.interact')}
          {...hold(Key.f)}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V3.5a1.5 1.5 0 0 1 3 0V11M14 11V5a1.5 1.5 0 0 1 3 0v6" />
            <path d="M17 11V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7l-2.7-3.6a1.5 1.5 0 0 1 2.4-1.8L8 14.5V13" />
          </svg>
        </button>
        <button
          type="button"
          className="touch-button"
          aria-label={t('touch.pickUp')}
          {...hold(Key.e)}
        >
          ↧
        </button>
        <button
          type="button"
          className="touch-button"
          aria-label={t('touch.run')}
          {...hold(Key.Shift)}
        >
          »
        </button>
      </div>
    </div>
  );
};
