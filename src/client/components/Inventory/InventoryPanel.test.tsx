import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Access,
  CharacterAction,
  Direction,
  type Player,
} from '../../../shared/types';
import { sendAction } from '../../io/network';
import { InventoryPanel } from './InventoryPanel';

const mocks = vi.hoisted(() => ({
  usePlayerForceUpdate: vi.fn(),
  sendAction: vi.fn(),
}));

vi.mock('../../hooks/usePlayerForceUpdate', () => ({
  usePlayerForceUpdate: mocks.usePlayerForceUpdate,
}));

vi.mock('../../io/network', () => ({
  sendAction: mocks.sendAction,
}));

vi.mock('./ItemIcon', () => ({
  ItemIcon: ({ spriteId }: { spriteId: number }) => (
    <span data-testid={`item-icon-${spriteId}`} />
  ),
}));

const potion = {
  id: 30,
  name: 'Potion',
  description: 'Restores health.',
  sprite: 3,
  type: 'consumable' as const,
};

const sword = {
  id: 20,
  name: 'Sword',
  description: 'Very sharp.',
  sprite: 2,
  type: 'weapon' as const,
};

const makePlayer = (overrides: Partial<Player> = {}): Player =>
  ({
    id: 'p1',
    name: 'Alice',
    sprite: 0,
    width: 64,
    height: 64,
    maxHealth: 100,
    attack: 15,
    attackRange: 64,
    level: 2,
    experience: 0,
    experienceToNextLevel: 100,
    inventory: [{ item: potion, quantity: 5 }],
    equipped: { weapon: sword },
    access: Access.USER,
    strength: 0,
    defense: 0,
    agility: 0,
    vitality: 0,
    unspentPoints: 0,
    speed: 1,
    mapId: 'map1',
    position: { x: 64, y: 64 },
    direction: Direction.Down,
    action: CharacterAction.Idle,
    health: 80,
    kind: 'player',
    ...overrides,
  }) as Player;

const openInventory = () => {
  act(() => {
    window.dispatchEvent(new Event('toggleInventory'));
  });
};

describe('InventoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePlayerForceUpdate.mockReturnValue(makePlayer());
  });

  it('opens from the inventory toggle and switches between bag and equipment', async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);

    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();

    openInventory();

    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByTitle('Potion')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /equipment/i }));

    expect(screen.getByTitle('Sword')).toBeInTheDocument();
    expect(screen.getByText('Attack')).toBeInTheDocument();
  });

  it('does not show equipped item descriptions until hover', async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(screen.getByRole('button', { name: /equipment/i }));

    expect(screen.queryByText('Very sharp.')).not.toBeInTheDocument();

    await user.hover(screen.getByTitle('Sword'));

    expect(screen.getByText('Very sharp.')).toBeInTheDocument();
  });

  it('asks for quantity before dropping a stacked item', async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(screen.getByTitle('Potion'));
    await user.click(screen.getByRole('button', { name: /^drop$/i }));

    expect(screen.getByText('Drop quantity')).toBeInTheDocument();
    expect(screen.getByText('Potion (5 available)')).toBeInTheDocument();
  });

  it('sends selected drop quantity for stacked items', async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(screen.getByTitle('Potion'));
    await user.click(screen.getByRole('button', { name: /^drop$/i }));

    const prompt = screen.getByText('Drop quantity').closest('div')!;
    const input = within(prompt).getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '3');
    await user.click(within(prompt).getByRole('button', { name: /^drop$/i }));

    expect(sendAction).toHaveBeenCalledWith({
      type: 'item',
      action: 'drop',
      item: 30,
      quantity: 3,
    });
  });
});
