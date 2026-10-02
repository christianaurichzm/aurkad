import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MapOrientation, MapStateClient } from '../../../shared/types';
import { MapEditor } from './MapEditor';

vi.mock('../../io/network', () => ({
  updateMap: vi.fn(),
  createMap: vi.fn(),
  resizeMap: vi.fn(),
}));

vi.mock('../ChatPanel', () => ({ chatResultMsg: vi.fn() }));

const map = (orientation?: MapOrientation) =>
  ({ id: '1', name: 'm', type: 'normal', orientation }) as MapStateClient;

const newMapOrientation = (maps: MapStateClient[]) => {
  const { container, unmount } = render(
    <MapEditor
      maps={maps}
      loadMaps={() => Promise.resolve([])}
      refreshData={vi.fn()}
      onDirtyChange={vi.fn()}
      requestDiscard={() => Promise.resolve(true)}
    />,
  );
  const { value } =
    container.querySelector<HTMLSelectElement>('#mapOrientation')!;
  unmount();
  return value;
};

describe('a new map', () => {
  it('is drawn the way most of the game is', () => {
    expect(newMapOrientation([])).toBe('orthogonal');
    expect(newMapOrientation([map('isometric')])).toBe('isometric');
    expect(newMapOrientation([map('isometric'), map('isometric'), map()])).toBe(
      'isometric',
    );
    // A map with no orientation is orthogonal, and a tie keeps the default.
    expect(newMapOrientation([map('isometric'), map()])).toBe('orthogonal');
  });
});
