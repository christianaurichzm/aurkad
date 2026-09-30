import React, { useEffect, useRef, useState } from 'react';
import { Key } from '../../../shared/types';
import { pressKey, releaseKey } from '../../io/keyboard';
import { useT } from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import { Icon } from '../common/Icon';

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
  const promptKey = useUIStore((state) => state.promptKey);

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
          <Icon name="up" />
        </button>
        <button
          type="button"
          className="touch-button touch-left"
          aria-label={t('touch.left')}
          data-direction={Key.ArrowLeft}
          aria-pressed={direction === Key.ArrowLeft}
        >
          <Icon name="left" />
        </button>
        <button
          type="button"
          className="touch-button touch-right"
          aria-label={t('touch.right')}
          data-direction={Key.ArrowRight}
          aria-pressed={direction === Key.ArrowRight}
        >
          <Icon name="right" />
        </button>
        <button
          type="button"
          className="touch-button touch-down"
          aria-label={t('touch.down')}
          data-direction={Key.ArrowDown}
          aria-pressed={direction === Key.ArrowDown}
        >
          <Icon name="down" />
        </button>
      </div>
      <div className="touch-actions">
        <button
          type="button"
          className="touch-button touch-attack"
          aria-label={t('touch.attack')}
          {...hold(Key.Control)}
        >
          <Icon name="attack" />
        </button>
        <button
          type="button"
          className="touch-button"
          aria-label={t('touch.interact')}
          data-ready={promptKey === Key.f || undefined}
          {...hold(Key.f)}
        >
          <Icon name="interact" />
        </button>
        <button
          type="button"
          className="touch-button"
          aria-label={t('touch.pickUp')}
          data-ready={promptKey === Key.e || undefined}
          {...hold(Key.e)}
        >
          <Icon name="pickup" />
        </button>
        <button
          type="button"
          className="touch-button"
          aria-label={t('touch.run')}
          {...hold(Key.Shift)}
        >
          <Icon name="run" />
        </button>
      </div>
    </div>
  );
};
