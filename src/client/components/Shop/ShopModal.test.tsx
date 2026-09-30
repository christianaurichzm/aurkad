import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopModal } from './ShopModal';

const mocks = vi.hoisted(() => ({
  fetchShop: vi.fn(),
  inventory: [] as { item: { id: number }; quantity: number }[],
  equipped: {},
}));

vi.mock('../../graphics/render', () => ({ renderItemIcon: vi.fn() }));
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

vi.mock('../../io/network', () => ({
  fetchShop: mocks.fetchShop,
}));

vi.mock('../../hooks/usePlayerForceUpdate', () => ({
  usePlayerForceUpdate: () => ({
    inventory: mocks.inventory,
    inventoryCapacity: 2,
    equipped: mocks.equipped,
  }),
}));

vi.mock('./ShopRow', () => ({
  ShopRow: ({
    product,
    bagFull,
    inPlace,
    onBought,
  }: {
    product: { item: { name: string } };
    bagFull: boolean;
    inPlace?: { name: string };
    onBought?: () => void;
  }) => (
    <li data-full={bagFull} data-in-place={inPlace?.name}>
      {product.item.name}
      <button onClick={onBought}>buy {product.item.name}</button>
    </li>
  ),
}));

const mockShop = {
  id: 'aurora-general',
  name: "Thomas's Wares",
  products: [
    {
      item: {
        id: 1,
        name: 'Apple',
        sprite: 1,
        description: 'A crisp apple.',
        type: 'consumable' as const,
      },
      currency: {
        id: 3,
        name: 'Gold',
        sprite: 3,
        description: 'Gold coin.',
        type: 'currency' as const,
      },
      price: 10,
    },
    {
      item: {
        id: 2,
        name: 'Iron Sword',
        sprite: 2,
        description: 'A sturdy blade.',
        type: 'weapon' as const,
      },
      currency: {
        id: 3,
        name: 'Gold',
        sprite: 3,
        description: 'Gold coin.',
        type: 'currency' as const,
      },
      price: 30,
    },
  ],
};

const open = () =>
  act(() => {
    window.dispatchEvent(
      new CustomEvent('open-shop', { detail: 'aurora-general' }),
    );
  });

describe('ShopModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchShop.mockResolvedValue(mockShop);
    mocks.inventory = [];
    mocks.equipped = {};
  });

  it('stays closed until the open-shop event fires', () => {
    render(<ShopModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens and displays shop name and products when open-shop event fires', async () => {
    render(<ShopModal />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('open-shop', { detail: 'aurora-general' }),
      );
    });

    expect(await screen.findByText("Thomas's Wares")).toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(mocks.fetchShop).toHaveBeenCalledWith('aurora-general');
  });

  it('closes when the close button is clicked and can be reopened by dispatching open-shop again', async () => {
    render(<ShopModal />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('open-shop', { detail: 'aurora-general' }),
      );
    });

    expect(await screen.findByText("Thomas's Wares")).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /close/i });
    await userEvent.click(closeBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('open-shop', { detail: 'aurora-general' }),
      );
    });

    expect(await screen.findByText("Thomas's Wares")).toBeInTheDocument();
    expect(mocks.fetchShop).toHaveBeenCalledTimes(2);
  });

  it('redraws the wallet as soon as a row reports a purchase', async () => {
    mocks.inventory = [{ item: { id: 3 }, quantity: 40 }];
    render(<ShopModal />);
    open();
    const wallet = (await screen.findByText('Gold')).closest('p');
    expect(wallet).toHaveTextContent('40 Gold');
    expect(wallet).toHaveTextContent('Bag 1/2');

    mocks.inventory = [{ item: { id: 3 }, quantity: 30 }];
    await userEvent.click(screen.getByRole('button', { name: 'buy Apple' }));

    expect(wallet).toHaveTextContent('30 Gold');
  });

  it('tells a row the bag is full only for what would need a new slot', async () => {
    mocks.inventory = [
      { item: { id: 3 }, quantity: 40 },
      { item: { id: 1 }, quantity: 2 },
    ];
    render(<ShopModal />);
    open();
    expect((await screen.findByText('Apple')).dataset.full).toBe('false');
    expect(screen.getByText('Iron Sword').dataset.full).toBe('true');
  });

  it('hands a row what is worn where its item would go', async () => {
    mocks.equipped = { weapon: { name: 'Hunting Bow' } };
    render(<ShopModal />);
    open();
    expect((await screen.findByText('Iron Sword')).dataset.inPlace).toBe(
      'Hunting Bow',
    );
    expect(screen.getByText('Apple').dataset.inPlace).toBeUndefined();
  });

  it('walks the buy buttons with the arrows', async () => {
    render(<ShopModal />);
    open();
    const first = await screen.findByRole('button', { name: 'buy Apple' });
    first.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('button', { name: 'buy Iron Sword' }),
    ).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
  });
});
