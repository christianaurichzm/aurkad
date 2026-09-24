import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ShopRow } from './ShopRow';
import { buyShopItem } from '../../io/network';
import { updatePlayerInventory } from '../../core/gameState';
import type { ProductDetailed } from '../../../shared/types';

vi.mock('../../graphics/render', () => ({ drawItemGeneric: vi.fn() }));
vi.mock('../../core/gameState', () => ({ updatePlayerInventory: vi.fn() }));
vi.mock('../../io/network', () => ({
  buyShopItem: vi.fn(),
  httpError: (e: Error) => e,
}));

it('gates affordability, applies confirmed inventory and reports errors inline', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const product: ProductDetailed = {
    item: {
      id: 1,
      name: 'Potion',
      description: 'Restores 50 health.',
      sprite: 0,
      type: 'consumable',
    },
    currency: {
      id: 3,
      name: 'Gold',
      description: '',
      sprite: 0,
      type: 'money',
    },
    price: 8,
  };
  const { rerender } = render(
    <ShopRow shopId="shop" product={product} balance={2} owned={1} />,
  );
  expect(
    screen.getByRole('button', { name: 'Not enough money' }),
  ).toBeDisabled();
  expect(screen.getByText('Owned: 1')).toBeVisible();
  expect(screen.getByText('Restores 50 health.')).toBeVisible();
  expect(buyShopItem).not.toHaveBeenCalled();
  rerender(<ShopRow shopId="shop" product={product} balance={40} owned={1} />);
  vi.mocked(buyShopItem).mockResolvedValueOnce({
    success: true,
    inventory: [],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Potion purchased.',
  );
  expect(updatePlayerInventory).toHaveBeenCalledWith([]);
  vi.mocked(buyShopItem).mockRejectedValueOnce(new Error('Inventory full'));
  fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Inventory full');
  expect(screen.queryByRole('dialog')).toBeNull();
});
