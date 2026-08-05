import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterAction,
  Direction,
  type MapStateClient,
} from '../../../shared/types';
import { DialogHost } from '../common/DialogHost';
import { ContentEditor } from './ContentEditor';

const mocks = vi.hoisted(() => ({
  fetchNpcs: vi.fn(),
  fetchItems: vi.fn(),
  fetchMaps: vi.fn(),
  useGame: vi.fn(),
}));

vi.mock('../../context/GameContext', () => ({
  useGame: mocks.useGame,
}));

vi.mock('../../graphics/render', () => ({
  drawSpriteGeneric: vi.fn(),
  renderItemIcon: vi.fn(),
}));

vi.mock('../Inventory/ItemIcon', () => ({
  ItemIcon: ({ spriteId }: { spriteId: number }) => (
    <span data-testid={`item-icon-${spriteId}`} />
  ),
}));

vi.mock('../ChatPanel', () => ({
  chatResultMsg: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  fetchNpcs: mocks.fetchNpcs,
  fetchItems: mocks.fetchItems,
  fetchMaps: mocks.fetchMaps,
  fetchShops: vi.fn().mockResolvedValue([]),
  fetchBehaviors: vi.fn().mockResolvedValue([]),
  listLootTables: vi.fn().mockResolvedValue([]),
  saveLootTable: vi.fn(),
  deleteLootTable: vi.fn(),
  listDialogs: vi.fn().mockResolvedValue([]),
  saveDialog: vi.fn(),
  deleteDialog: vi.fn(),
  createNpc: vi.fn(),
  updateNpc: vi.fn(),
  deleteNpc: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  createMap: vi.fn(),
  updateMap: vi.fn(),
}));

const currentMap: MapStateClient = {
  id: 'town',
  name: 'Town',
  type: 'normal',
  tiles: [],
  droppedItems: [],
  npcs: {},
  players: {},
};

const npc = {
  id: 'trainer',
  name: 'Trainer',
  sprite: 1,
  width: 64,
  height: 64,
  maxHealth: 100,
  health: 100,
  attack: 10,
  attackRange: 64,
  behavior: 'neutral',
  experienceValue: 5,
  itemsToDrop: [],
  position: { x: 0, y: 0 },
  direction: Direction.Down,
  action: CharacterAction.Idle,
  mapId: 'town',
  kind: 'npc',
};

const openContentEditor = () => {
  act(() => {
    window.dispatchEvent(new Event('toggleContentEditor'));
  });
};

describe('ContentEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({ clearRect: vi.fn() })),
    });
    mocks.useGame.mockReturnValue({ map: currentMap });
    mocks.fetchNpcs.mockResolvedValue([npc]);
    mocks.fetchItems.mockResolvedValue([]);
    mocks.fetchMaps.mockResolvedValue([currentMap]);
  });

  it('asks before closing with Escape when editor fields are dirty', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ContentEditor />
        <DialogHost />
      </>,
    );

    openContentEditor();

    expect(await screen.findByText('Content Editor')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('NPC name'), 'Trainer');
    await user.keyboard('{Escape}');

    expect(
      await screen.findByRole('dialog', { name: 'Discard changes?' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Discard changes?' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Content Editor')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(
      await screen.findByRole('dialog', { name: 'Discard changes?' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() =>
      expect(screen.queryByText('Content Editor')).not.toBeInTheDocument(),
    );
  });
});
