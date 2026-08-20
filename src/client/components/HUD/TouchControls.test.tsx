import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    pressKey.mockClear();
    releaseKey.mockClear();
    render(<TouchControls />);
  });

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
