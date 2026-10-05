import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapOrientation, MapStateClient } from '../../../shared/types';
import { MapEditor } from './MapEditor';
import { createMap, updateMap } from '../../io/network';
import { TILE_SIZE } from '../../../shared/constants';
import { chatResultMsg } from '../ChatPanel';

vi.mock('../../io/network', () => ({
  updateMap: vi.fn(),
  createMap: vi.fn(),
  resizeMap: vi.fn(),
}));

vi.mock('../ChatPanel', () => ({ chatResultMsg: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

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
  it('uses the loaded orientation when the map list arrives after opening the form', async () => {
    const props = {
      loadMaps: () => Promise.resolve([]),
      refreshData: vi.fn(),
      onDirtyChange: vi.fn(),
      requestDiscard: () => Promise.resolve(true),
    };
    const { container, rerender } = render(<MapEditor {...props} maps={[]} />);

    await act(() =>
      Promise.resolve(
        rerender(<MapEditor {...props} maps={[map('isometric')]} />),
      ),
    );

    expect(
      container.querySelector<HTMLSelectElement>('#mapOrientation')!.value,
    ).toBe('isometric');
  });

  it('keeps a chosen orientation when content refreshes during editing', async () => {
    const props = {
      loadMaps: () => Promise.resolve([]),
      refreshData: vi.fn(),
      onDirtyChange: vi.fn(),
      requestDiscard: () => Promise.resolve(true),
    };
    const { container, rerender } = render(<MapEditor {...props} maps={[]} />);
    const orientation =
      container.querySelector<HTMLSelectElement>('#mapOrientation')!;
    fireEvent.change(orientation, { target: { value: 'isometric' } });

    await act(() =>
      Promise.resolve(rerender(<MapEditor {...props} maps={[map()]} />)),
    );

    expect(orientation.value).toBe('isometric');
  });

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

describe('saving a map', () => {
  it.each([
    { operation: 'create', failure: 'empty' },
    { operation: 'update', failure: 'empty' },
    { operation: 'create', failure: 'rejection' },
    { operation: 'update', failure: 'rejection' },
  ] as const)(
    'keeps $operation edits available for retry after $failure',
    async ({ operation, failure }) => {
      const refreshData = vi.fn();
      const onDirtyChange = vi.fn();
      const { container } = render(
        <MapEditor
          maps={[map()]}
          loadMaps={() => Promise.resolve([{ value: '1', label: '1 - m' }])}
          refreshData={refreshData}
          onDirtyChange={onDirtyChange}
          requestDiscard={() => Promise.resolve(true)}
        />,
      );
      if (operation === 'update') {
        await screen.findByRole('option', { name: '1 - m' });
        fireEvent.change(container.querySelector('select')!, {
          target: { value: '1' },
        });
        await screen.findByRole('button', { name: 'Save Map' });
      }
      const save = operation === 'create' ? createMap : updateMap;
      if (failure === 'empty') vi.mocked(save).mockResolvedValueOnce(null);
      else vi.mocked(save).mockRejectedValueOnce(new Error('Request failed'));
      vi.mocked(save).mockResolvedValueOnce(map());
      fireEvent.change(
        screen.getByPlaceholderText('Map name', { exact: true }),
        { target: { value: 'Keep these edits' } },
      );
      const button = operation === 'create' ? 'Create Map' : 'Save Map';
      fireEvent.click(screen.getByRole('button', { name: button }));
      await waitFor(() =>
        expect(chatResultMsg).toHaveBeenCalledWith(
          false,
          expect.any(String),
          expect.any(String),
        ),
      );

      await waitFor(() =>
        expect(
          screen.getByPlaceholderText('Map name', { exact: true }),
        ).toHaveValue('Keep these edits'),
      );
      expect(refreshData).not.toHaveBeenCalled();
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      fireEvent.click(screen.getByRole('button', { name: button }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(refreshData).toHaveBeenCalledTimes(1));
    },
  );
});

describe('border links', () => {
  it('converts a fixed landing into a continuous link and saves its offset', async () => {
    vi.mocked(updateMap).mockResolvedValueOnce(map());
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
