import { expect, it } from 'vitest';
import { freeOfTheWorld } from './MapEditorWindow';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height }) as DOMRect;

it('goes under the world on an upright phone', () => {
  expect(freeOfTheWorld(rect(10, 90, 535, 375), 555, 1038)).toEqual({
    top: 473,
    left: 8,
    width: 539,
    height: 557,
  });
});

it('goes beside the world on a phone on its side', () => {
  expect(freeOfTheWorld(rect(0, 0, 520, 390), 844, 390)).toEqual({
    top: 8,
    left: 528,
    width: 308,
    height: 374,
  });
});

it('floats when the world leaves no room for the palette', () => {
  expect(freeOfTheWorld(rect(0, 0, 690, 480), 700, 560)).toBeNull();
});
