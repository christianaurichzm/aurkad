import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDraggable } from './useDraggable';

const panelOf = (width: number, height: number) => {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0 }) as DOMRect;
  return el;
};

const screen = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    writable: true,
  });
};

describe('useDraggable', () => {
  beforeEach(() => screen(1280, 800));

  it('leaves a panel where it opens when the screen has room for it', () => {
    const { result } = renderHook(() => useDraggable(100, 80));

    act(() => result.current.ref(panelOf(512, 400)));

    expect(result.current.pos).toEqual({ x: 100, y: 80 });
  });

  // Offsets chosen on a desktop put half the editor off a phone screen, with
  // no titlebar left to drag.
  it('pulls a panel onto the screen when the offset does not fit', () => {
    screen(393, 727);
    const { result } = renderHook(() => useDraggable(100, 80));

    act(() => result.current.ref(panelOf(377, 691)));

    // Nudged up as well as left, so the bottom of the panel is not cut off.
    expect(result.current.pos).toEqual({ x: 8, y: 28 });
  });

  it('rotating the phone brings it back into view', () => {
    const { result } = renderHook(() => useDraggable(600, 400));
    act(() => result.current.ref(panelOf(300, 200)));
    expect(result.current.pos).toEqual({ x: 600, y: 400 });

    screen(740, 360);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.pos).toEqual({ x: 432, y: 152 });
  });
});
