import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { MapStateClient } from '../../../shared/types';
import { MapEditorTools } from './MapEditorTools';
import { saveCurrentMap } from '../../graphics/mapEditor';
import { fetchMap } from '../../io/network';
import { useUIStore } from '../../stores/uiStore';

vi.mock('../../graphics/mapEditor', async () => {
  const { useUIStore } = await import('../../stores/uiStore');
  const noop = () => {};
  return {
    saveCurrentMap: vi.fn(),
    setMapEdited: (edited: boolean) =>
      useUIStore.getState().setMapEdited(edited),
    setEditorSaving: noop,
    fillMap: noop,
    toggleBlocking: noop,
    toggleWarping: noop,
    toggleNpc: noop,
    toggleItem: noop,
    toggleShop: noop,
    toggleBank: noop,
    toggleAvoidNpc: noop,
    toggleFringe: noop,
    toggleMask: noop,
    toggleHeal: noop,
    toggleKill: noop,
    toggleWarn: noop,
    toggleDoor: noop,
    toggleSound: noop,
    toggleChangeSprite: noop,
    toggleScript: noop,
    setPendingScriptTrigger: noop,
    toggleConditionalBlock: noop,
    setEditorMusic: noop,
    setEditorMapId: noop,
    setEditorTiles: noop,
    undo: noop,
    redo: noop,
  };
});

vi.mock('../../io/network', () => ({
  fetchMap: vi.fn(),
  fetchMaps: vi.fn(() => Promise.resolve([])),
  fetchNpcs: vi.fn(() => Promise.resolve([])),
  fetchItems: vi.fn(() => Promise.resolve([])),
  fetchShops: vi.fn(() => Promise.resolve([])),
  fetchBehaviors: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../core/gameState', () => ({ getGameState: () => ({ id: '1' }) }));
vi.mock('../common/SpritePreview', () => ({ SpritePreview: () => null }));

beforeEach(() => {
  vi.mocked(saveCurrentMap).mockReset();
  useUIStore.getState().setMapEdited(false);
});

it('loads the map PvP and saves the one chosen', async () => {
  vi.mocked(fetchMap).mockResolvedValue({
    id: '1',
    name: 'Arena',
    type: 'pvp',
    tiles: [],
  } as unknown as MapStateClient);
  vi.mocked(saveCurrentMap).mockResolvedValue({ success: true, warnings: [] });
  render(<MapEditorTools />);

  const pvp = await screen.findByDisplayValue('On, no penalty');
  fireEvent.change(pvp, { target: { value: 'normal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() =>
    expect(saveCurrentMap).toHaveBeenCalledWith('Arena', 'normal'),
  );
});
