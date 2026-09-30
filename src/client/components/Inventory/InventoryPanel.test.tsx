import { act, render, screen } from '@testing-library/react';
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

// Both draw from the atlas onto a canvas, which jsdom has neither of.
vi.mock('../../graphics/render', () => ({ renderItemIcon: vi.fn() }));
vi.mock('../common/SpritePreview', () => ({ SpritePreview: () => null }));
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

const potion = {
  id: 30,
  name: 'Potion',
  description: 'Restores health.',
  sprite: 3,
  type: 'consumable' as const,
  effects: [{ attribute: 'health' as const, type: 'add' as const, value: 50 }],
};

const sword = {
  id: 20,
  name: 'Sword',
  description: 'Very sharp.',
  sprite: 2,
  type: 'weapon' as const,
  effects: [{ attribute: 'attack' as const, type: 'add' as const, value: 5 }],
};

const axe = {
  id: 21,
  name: 'Axe',
  description: 'Heavy.',
  sprite: 4,
  type: 'weapon' as const,
  effects: [
    { attribute: 'attack' as const, type: 'add' as const, value: 8 },
    { attribute: 'speed' as const, type: 'add' as const, value: -1 },
  ],
};

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
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
  inventoryCapacity: 10,
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
});

const openInventory = () => {
  act(() => {
    window.dispatchEvent(new Event('toggleInventory'));
  });
};

const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('InventoryPanel', () => {
  beforeEach(() => {
    mocks.sendAction.mockClear();
    mocks.usePlayerForceUpdate.mockReturnValue(makePlayer());
  });

  it('opens from the inventory toggle, with how full the bag is', () => {
    const { container } = render(<InventoryPanel />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openInventory();

    expect(screen.getByRole('dialog', { name: 'Inventory' })).toHaveClass(
      'inventory-panel',
    );
    expect(screen.getByText('1/10')).toBeInTheDocument();
    expect(button('Potion, 5')).toBeInTheDocument();
    // One box per slot of the bag, taken or free.
    expect(container.querySelectorAll('.bag-grid > .item-slot')).toHaveLength(
      10,
    );
  });

  it('says so when the bag holds nothing', () => {
    mocks.usePlayerForceUpdate.mockReturnValue(makePlayer({ inventory: [] }));
    render(<InventoryPanel />);
    openInventory();

    expect(screen.getByText('Your bag is empty.')).toBeInTheDocument();
    expect(screen.getByText('0/10')).toBeInTheDocument();
  });

  it('shows what is worn, slot by slot, on the equipment tab', async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(screen.getByRole('tab', { name: 'Equipment' }));

    expect(button('Sword, Weapon')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Helmet: empty' })).toBeVisible();
    expect(screen.getByText('Attack')).toBeInTheDocument();

    await user.click(button('Sword, Weapon'));
    expect(screen.getByText('Weapon · Equipped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Drop' })).toBeNull();

    await user.click(button('Unequip'));
    expect(sendAction).toHaveBeenCalledWith({
      type: 'item',
      action: 'use',
      item: 20,
    });
  });

  it('says what an item is on hover, and the rest once it is picked', async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(button('Potion, 5'));
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'PotionConsumable · +50 Health · x5',
    );
    expect(screen.queryByText('Restores health.')).not.toBeInTheDocument();

    await user.click(button('Potion, 5'));
    expect(screen.getByText('Restores health.')).toBeInTheDocument();

    await user.click(button('Use'));
    expect(sendAction).toHaveBeenCalledWith({
      type: 'item',
      action: 'use',
      item: 30,
    });
  });

  it('sets a weapon in the bag against the one in hand', async () => {
    mocks.usePlayerForceUpdate.mockReturnValue(
      makePlayer({ inventory: [{ item: axe, quantity: 1 }] }),
    );
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(button('Axe'));

    expect(screen.getByText('+3 Attack vs Sword')).toHaveAttribute(
      'data-change',
      'up',
    );
    expect(screen.getByText('−1 Speed vs Sword')).toHaveAttribute(
      'data-change',
      'down',
    );
  });

  it('asks how many of a stack to drop, and drops that many', async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(button('Potion, 5'));
    await user.click(button('Drop'));

    expect(screen.getAllByText('Drop how many?')[0]).toBeInTheDocument();
    await user.click(button('One more'));
    await user.click(button('One more'));
    await user.click(button('Drop 3'));

    expect(sendAction).toHaveBeenCalledWith({
      type: 'item',
      action: 'drop',
      item: 30,
      quantity: 3,
    });
  });

  it('asks before dropping the only one, and takes no for an answer', async () => {
    mocks.usePlayerForceUpdate.mockReturnValue(
      makePlayer({ inventory: [{ item: axe, quantity: 1 }] }),
    );
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(button('Axe'));
    await user.click(button('Drop'));
    expect(screen.getByText('Drop Axe?')).toBeInTheDocument();
    await user.click(button('Cancel'));

    expect(sendAction).not.toHaveBeenCalled();
    expect(button('Equip')).toBeInTheDocument();
  });

  it('offers no way to drop what is bound', async () => {
    mocks.usePlayerForceUpdate.mockReturnValue(
      makePlayer({
        inventory: [{ item: { ...axe, bound: true }, quantity: 1 }],
      }),
    );
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(button('Axe'));

    expect(screen.getByText(/^Bound:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Drop' })).toBeNull();
  });

  it('warns that a full bag sends what is taken off to the ground', async () => {
    mocks.usePlayerForceUpdate.mockReturnValue(
      makePlayer({ inventoryCapacity: 1 }),
    );
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    await user.click(button('Sword, Weapon'));

    expect(screen.getByText(/^Your bag is full/)).toBeInTheDocument();
  });

  it('walks the bag with the arrow keys', async () => {
    mocks.usePlayerForceUpdate.mockReturnValue(
      makePlayer({
        inventory: [
          { item: potion, quantity: 5 },
          { item: axe, quantity: 1 },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<InventoryPanel />);
    openInventory();

    button('Potion, 5').focus();
    await user.keyboard('{ArrowRight}');

    expect(button('Axe')).toHaveFocus();
  });

  it('hands the picked item to an open trade, and only while it is open', async () => {
    const offered = vi.fn();
    window.addEventListener('inventory:item-for-trade', offered);
    const trade = (open: boolean) =>
      act(() => {
        window.dispatchEvent(
          new Event(open ? 'trade:active' : 'trade:inactive'),
        );
      });
    const user = userEvent.setup();
    render(<InventoryPanel />);

    // The trade window has the bag in it: it does not open this one.
    trade(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openInventory();
    await user.click(button('Potion, 5'));
    await user.click(button('Offer in trade'));

    expect(offered.mock.calls[0]?.[0]).toMatchObject({
      detail: { itemId: 30, quantity: 5 },
    });

    trade(false);
    expect(screen.queryByRole('button', { name: 'Offer in trade' })).toBeNull();
    window.removeEventListener('inventory:item-for-trade', offered);
  });
});
