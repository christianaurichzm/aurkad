import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopModal } from './ShopModal';

const mocks = vi.hoisted(() => ({
  fetchShop: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  fetchShop: mocks.fetchShop,
}));

vi.mock('./ShopRow', () => ({
  ShopRow: ({ product }: { product: { item: { name: string } } }) => (
    <div data-testid="shop-row">{product.item.name}</div>
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
  ],
};

describe('ShopModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchShop.mockResolvedValue(mockShop);
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
});
