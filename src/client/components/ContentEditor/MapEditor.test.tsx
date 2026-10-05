import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MapOrientation, MapStateClient } from '../../../shared/types';
import { MapEditor } from './MapEditor';
import { updateMap } from '../../io/network';
import { TILE_SIZE } from '../../../shared/constants';

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

describe('border links', () => {
  it('converts a fixed landing into a continuous link and saves its offset', async () => {
    const maps = [
      {
        ...map(),
        borderLinks: {
          left: { to: '2', position: { x: 3 * TILE_SIZE, y: 0 } },
        },
      },
      { ...map(), id: '2', name: 'West' },
    ];
    const { container } = render(
      <MapEditor
        maps={maps}
        loadMaps={() => Promise.resolve([{ value: '1', label: '1 - m' }])}
        refreshData={vi.fn()}
        onDirtyChange={vi.fn()}
        requestDiscard={() => Promise.resolve(true)}
      />,
    );
    await screen.findByRole('option', { name: '1 - m' });
    fireEvent.change(container.querySelector('select')!, {
      target: { value: '1' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /3.*0/ }));
    const offsets = screen.getAllByRole('spinbutton', { name: /offset/i });
    fireEvent.change(offsets[2], { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Map' }));

    await waitFor(() =>
      expect(updateMap).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({
          borderLinks: expect.objectContaining({
            left: { to: '2', offset: -2 },
          }),
        }),
      ),
    );
  });
});
