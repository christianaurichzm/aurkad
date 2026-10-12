import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Key } from '../../shared/types';
import { pollGamepad } from './gamepad';

const { pressKey, releaseKey } = vi.hoisted(() => ({
  pressKey: vi.fn(),
  releaseKey: vi.fn(),
}));

vi.mock('./keyboard', () => ({ pressKey, releaseKey }));

const pad = (buttons: number[], axes: number[] = [0, 0]) =>
  ({
    connected: true,
    axes,
    buttons: Array.from({ length: 16 }, (_, index) => ({
      pressed: buttons.includes(index),
    })),
  }) as unknown as Gamepad;

const plug = (...pads: (Gamepad | null)[]) => {
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => pads,
  });
};

describe('pollGamepad', () => {
  beforeEach(() => {
    // The module holds the previous frame's keys; an empty poll clears it so
    // each case starts with nothing held.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    document.body.innerHTML = '';
    plug(null);
    pollGamepad();
    pressKey.mockClear();
    releaseKey.mockClear();
  });

  it('sends nothing while no pad is connected', () => {
    plug(null);
    pollGamepad();

    expect(pressKey).not.toHaveBeenCalled();
    expect(releaseKey).not.toHaveBeenCalled();
  });

  it('presses once for a held button and releases when it comes up', () => {
    plug(pad([0]));
    pollGamepad();
    pollGamepad();

    expect(pressKey).toHaveBeenCalledTimes(1);
    expect(pressKey).toHaveBeenCalledWith(Key.Control, 'gamepad');

    plug(pad([]));
    pollGamepad();

    expect(releaseKey).toHaveBeenCalledExactlyOnceWith(Key.Control, 'gamepad');
  });

  it('walks on a pushed stick and stops when it recentres', () => {
    plug(pad([], [0.9, 0]));
    pollGamepad();

    expect(pressKey).toHaveBeenCalledExactlyOnceWith(Key.ArrowRight, 'gamepad');

    plug(pad([], [0, 0]));
    pollGamepad();

    expect(releaseKey).toHaveBeenCalledExactlyOnceWith(
      Key.ArrowRight,
      'gamepad',
    );
  });

  it('ignores a stick resting off centre', () => {
    plug(pad([], [0.4, -0.4]));
    pollGamepad();

    expect(pressKey).not.toHaveBeenCalled();
  });

  it('reads the d-pad as the arrow keys', () => {
    plug(pad([12]));
    pollGamepad();

    expect(pressKey).toHaveBeenCalledExactlyOnceWith(Key.ArrowUp, 'gamepad');
  });

  // The keyboard's own rule: what is typed into a field is not a move.
  it('lets go while a text field has the focus, and holds again after', () => {
    plug(pad([15]));
    pollGamepad();
    document.body.innerHTML = '<input>';
    document.querySelector('input')!.focus();
    pollGamepad();

    expect(releaseKey).toHaveBeenCalledExactlyOnceWith(
      Key.ArrowRight,
      'gamepad',
    );

    document.body.innerHTML = '';
    pollGamepad();

    expect(pressKey).toHaveBeenCalledTimes(2);
  });

  it('drops everything held when the pad is unplugged', () => {
    plug(pad([0, 12]));
    pollGamepad();
    plug(null);
    pollGamepad();

    expect(releaseKey.mock.calls.flat()).toEqual(
      expect.arrayContaining([Key.Control, Key.ArrowUp]),
    );
  });
});
