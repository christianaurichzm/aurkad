import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Key } from '../../../shared/types';
import { TouchControls } from './TouchControls';

const { pressKey, releaseKey } = vi.hoisted(() => ({
  pressKey: vi.fn(),
  releaseKey: vi.fn(),
}));

vi.mock('../../io/keyboard', () => ({ pressKey, releaseKey }));

describe('TouchControls', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    Element.prototype.setPointerCapture = vi.fn();
    pressKey.mockClear();
    releaseKey.mockClear();
    render(<TouchControls />);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('holds the key down for as long as the button is held', () => {
    const up = screen.getByLabelText('Move up');

    fireEvent.pointerDown(up);

    expect(pressKey).toHaveBeenCalledExactlyOnceWith(Key.ArrowUp);
    expect(releaseKey).not.toHaveBeenCalled();

    fireEvent.pointerUp(up);

    expect(releaseKey).toHaveBeenCalledExactlyOnceWith(Key.ArrowUp);
  });

  // A thumb dragged off or an incoming call cancels the pointer instead of
  // lifting it, which must release too.
  it('releases on a cancelled pointer', () => {
    const attack = screen.getByLabelText('Attack');

    fireEvent.pointerDown(attack);
    fireEvent.pointerCancel(attack);

    expect(pressKey).toHaveBeenCalledExactlyOnceWith(Key.Control);
    expect(releaseKey).toHaveBeenCalledExactlyOnceWith(Key.Control);
  });

  it('changes direction under a captured pointer and stops in the center', () => {
    const up = screen.getByLabelText('Move up');
    const pad = up.parentElement!;
    vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 150, 150),
    );
    fireEvent.pointerDown(up);
    fireEvent.pointerMove(pad, { clientX: 145, clientY: 75 });
    expect(releaseKey).toHaveBeenCalledWith(Key.ArrowUp);
    expect(pressKey).toHaveBeenLastCalledWith(Key.ArrowRight);
    expect(screen.getByLabelText('Move right')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.pointerMove(pad, { clientX: 140, clientY: 75 });
    expect(pressKey).toHaveBeenCalledTimes(2);
    fireEvent.pointerMove(pad, { clientX: 75, clientY: 75 });
    expect(releaseKey).toHaveBeenLastCalledWith(Key.ArrowRight);
    fireEvent.pointerMove(pad, { clientX: 75, clientY: 145 });
    expect(pressKey).toHaveBeenLastCalledWith(Key.ArrowDown);
    fireEvent.lostPointerCapture(pad);
    expect(releaseKey).toHaveBeenLastCalledWith(Key.ArrowDown);
  });

  it('offers a labelled button for every key the game needs', () => {
    for (const label of [
      'Move up',
      'Move down',
      'Move left',
      'Move right',
      'Attack',
      'Interact',
      'Pick up',
      'Run',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
