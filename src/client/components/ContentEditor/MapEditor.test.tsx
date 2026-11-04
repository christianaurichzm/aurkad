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
import { createMap, resizeMap, updateMap } from '../../io/network';
import { TILE_SIZE } from '../../../shared/constants';
import { useUIStore } from '../../stores/uiStore';

vi.mock('../../io/network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../io/network')>()),
  updateMap: vi.fn(),
  createMap: vi.fn(),
  resizeMap: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  useUIStore.setState({
    chat: { messages: [], inputValue: '', scope: 'map' },
  });
});

const lastChatLine = () => useUIStore.getState().chat.messages.at(-1)?.message;

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
      await waitFor(() => expect(lastChatLine()).toMatch(/^Error saving map/));

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

describe('resizing a map', () => {
  it('says why the server refused the size', async () => {
    vi.mocked(resizeMap).mockRejectedValueOnce({
      status: 400,
      message: 'Too small: expected number to be >=1',
    });
    const refreshData = vi.fn();
    const { container } = render(
      <MapEditor
        maps={[map()]}
        loadMaps={() => Promise.resolve([{ value: '1', label: '1 - m' }])}
        refreshData={refreshData}
        onDirtyChange={vi.fn()}
        requestDiscard={() => Promise.resolve(true)}
      />,
    );
    await screen.findByRole('option', { name: '1 - m' });
    fireEvent.change(container.querySelector('select')!, {
      target: { value: '1' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Resize' }));
    fireEvent.change(screen.getByPlaceholderText('Cols'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastChatLine()).toBe(
        'Error resizing map: Too small: expected number to be >=1',
      ),
    );
    expect(resizeMap).toHaveBeenCalledWith('1', 0, 14);
    expect(refreshData).not.toHaveBeenCalled();
  });
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

describe('the music field', () => {
  it('clears the music when emptied, rather than leaving it out', async () => {
    vi.mocked(updateMap).mockResolvedValueOnce(map());
    const { container } = render(
      <MapEditor
        maps={[{ ...map(), music: 'theme.mp3' }]}
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
    const music = await screen.findByPlaceholderText('music.mp3');
    await waitFor(() => expect(music).toHaveValue('theme.mp3'));
    fireEvent.change(music, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Map' }));

    await waitFor(() =>
      expect(updateMap).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ music: '' }),
      ),
    );
  });
});

describe('the PvP field', () => {
  it('shows what a map typed PvP plays as and saves the chosen morale with the type', async () => {
    vi.mocked(updateMap).mockResolvedValueOnce(map());
    const { container } = render(
      <MapEditor
        maps={[{ ...map(), type: 'pvp' }]}
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
    const pvp = container.querySelector<HTMLSelectElement>('#mapPvp')!;
    await waitFor(() => expect(pvp).toHaveValue('no-penalty'));
    fireEvent.change(pvp, { target: { value: 'normal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Map' }));

    await waitFor(() =>
      expect(updateMap).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ type: 'pvp', pvp: 'normal' }),
      ),
    );
  });

  it('saves a safe map as a normal one', async () => {
    vi.mocked(createMap).mockResolvedValueOnce(map());
    const { container } = render(
      <MapEditor
        maps={[]}
        loadMaps={() => Promise.resolve([])}
        refreshData={vi.fn()}
        onDirtyChange={vi.fn()}
        requestDiscard={() => Promise.resolve(true)}
      />,
    );
    expect(container.querySelector('#mapPvp')).toHaveValue('safe');
    fireEvent.change(screen.getByPlaceholderText('Map name', { exact: true }), {
      target: { value: 'Town' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Map' }));

    await waitFor(() =>
      expect(createMap).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'normal', pvp: 'safe' }),
      ),
    );
  });
});
