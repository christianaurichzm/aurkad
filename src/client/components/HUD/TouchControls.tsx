import React from 'react';
import { Key } from '../../../shared/types';
import { pressKey, releaseKey } from '../../io/keyboard';
import { useT } from '../../i18n';

// The keyboard the phone does not have, shown only where the primary
// pointer is a finger (CSS `pointer: coarse`), so a desktop never pays.
//
// Each button is a hold, not a tap: the server keeps walking while a
// direction key is down, as with the arrow keys. A touch pointer keeps an
// implicit capture on the element it started on, so a thumb sliding off
// still releases the key here, and changing direction takes a lift.
const hold = (key: Key) => ({
  onPointerDown: (event: React.PointerEvent) => {
    // Stops the tap turning into focus, a synthesized mouse event and, on a
    // double tap, a zoom.
    event.preventDefault();
    void pressKey(key);
  },
  onPointerUp: () => releaseKey(key),
  onPointerCancel: () => releaseKey(key),
  onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
});

export const TouchControls: React.FC = () => {
  const t = useT();

  return (
    <div id="touchControls" aria-label={t('touch.controls')} role="group">
      <div className="touch-dpad">
        <button
          type="button"
          className="touch-button touch-up"
          aria-label={t('touch.up')}
          {...hold(Key.ArrowUp)}
        >
          ▲
        </button>
        <button
          type="button"
          className="touch-button touch-left"
          aria-label={t('touch.left')}
          {...hold(Key.ArrowLeft)}
        >
          ◀
        </button>
        <button
          type="button"
          className="touch-button touch-right"
          aria-label={t('touch.right')}
          {...hold(Key.ArrowRight)}
        >
          ▶
        </button>
        <button
          type="button"
          className="touch-button touch-down"
          aria-label={t('touch.down')}
          {...hold(Key.ArrowDown)}
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
          ☰
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
